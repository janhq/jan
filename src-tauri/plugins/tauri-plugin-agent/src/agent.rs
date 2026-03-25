//! ReAct agent loop.
//!
//! Talks to any OpenAI-compatible chat completions endpoint.
//! Accepts any [`ToolDispatcher`] implementation.
//!
//! Loop:
//!   1. Send user message + history to model
//!   2. Model emits tool calls → dispatched via `ToolDispatcher`
//!   3. Repeat until plain-text response; stop on max_steps or budget

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::ToolDispatcher;
use crate::utils::{compress_tool_result, summarize_result, truncate_str};

// ── Configuration ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub max_steps:             usize,
    pub token_budget:          u32,
    pub budget_warn_pct:       f32,
    pub max_retries:           usize,
    pub compaction_keep:       usize,
    pub max_tool_result_chars: usize,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_steps:             50,
            token_budget:          32_000,
            budget_warn_pct:       0.80,
            max_retries:           3,
            compaction_keep:       6,
            max_tool_result_chars: 4_096,
        }
    }
}

// ── Events ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Thinking         { step: usize },
    ToolCall         { step: usize, tool_id: String, args: Value },
    ToolResult       { step: usize, tool_id: String, ok: bool, elapsed_ms: u64, summary: String },
    ToolLog          { step: usize, tool_id: String, message: String },
    Retrying         { step: usize, attempt: usize, delay_ms: u64 },
    ContextCompacted { turns_removed: usize },
    TokenBudget      { used: u32, total: u32 },
}

// ── Finish reason ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    Stop,
    MaxSteps,
    BudgetExhausted,
    Cancelled,
}

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role:         String,
    pub content:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls:   Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name:         Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentResponse {
    pub content:       String,
    pub tokens_used:   u32,
    pub steps:         usize,
    pub finish_reason: FinishReason,
}

// ── Agent loop ────────────────────────────────────────────────────────────────

pub struct AgentLoop {
    pub base_url:  String,
    pub model_id:  String,
    pub api_key:   Option<String>,
    dispatcher:    Box<dyn ToolDispatcher>,
    system_prompt: String,
    config:        AgentConfig,
    client:        reqwest::Client,
}

impl AgentLoop {
    pub fn new(
        base_url:   String,
        model_id:   String,
        dispatcher: impl ToolDispatcher + 'static,
    ) -> Self {
        Self::new_with_config(base_url, model_id, None, dispatcher, AgentConfig::default())
    }

    pub fn new_with_key(
        base_url:   String,
        model_id:   String,
        api_key:    Option<String>,
        dispatcher: impl ToolDispatcher + 'static,
    ) -> Self {
        Self::new_with_config(base_url, model_id, api_key, dispatcher, AgentConfig::default())
    }

    pub fn new_with_config(
        base_url:   String,
        model_id:   String,
        api_key:    Option<String>,
        dispatcher: impl ToolDispatcher + 'static,
        config:     AgentConfig,
    ) -> Self {
        Self {
            base_url,
            model_id,
            api_key,
            dispatcher:    Box::new(dispatcher),
            system_prompt: build_system_prompt(),
            config,
            client:        reqwest::Client::new(),
        }
    }

    pub async fn run(
        &self,
        history:      &[ChatMessage],
        user_message: &str,
        on_event:     &mut (impl FnMut(AgentEvent) + Send),
    ) -> Result<AgentResponse, String> {
        self.run_cancellable(history, user_message, on_event, CancellationToken::new()).await
    }

    pub async fn run_cancellable(
        &self,
        history:      &[ChatMessage],
        user_message: &str,
        on_event:     &mut (impl FnMut(AgentEvent) + Send),
        cancel:       CancellationToken,
    ) -> Result<AgentResponse, String> {
        let mut messages: Vec<ChatMessage> = vec![ChatMessage {
            role:         "system".into(),
            content:      Some(self.system_prompt.clone()),
            tool_calls:   None,
            tool_call_id: None,
            name:         None,
        }];
        messages.extend_from_slice(history);
        messages.push(ChatMessage {
            role:         "user".into(),
            content:      Some(user_message.to_string()),
            tool_calls:   None,
            tool_call_id: None,
            name:         None,
        });

        let mut cumulative_tokens: u32 = 0;
        let mut steps = 0;

        loop {
            // ── Cancellation check (top of loop) ─────────────────────────
            if cancel.is_cancelled() {
                return Ok(AgentResponse {
                    content:       String::new(),
                    tokens_used:   cumulative_tokens,
                    steps,
                    finish_reason: FinishReason::Cancelled,
                });
            }

            steps += 1;
            if steps > self.config.max_steps {
                return Ok(AgentResponse {
                    content:       "Agent reached max steps limit.".into(),
                    tokens_used:   cumulative_tokens,
                    steps,
                    finish_reason: FinishReason::MaxSteps,
                });
            }

            on_event(AgentEvent::Thinking { step: steps });

            // Rebuild tools array each step so hot-loaded tools are visible
            let tools = self.build_tools_array();

            let warn_threshold =
                (self.config.token_budget as f32 * self.config.budget_warn_pct) as u32;

            if cumulative_tokens >= warn_threshold {
                on_event(AgentEvent::TokenBudget {
                    used:  cumulative_tokens,
                    total: self.config.token_budget,
                });
                let removed = compact_context(&mut messages, self.config.compaction_keep);
                if removed > 0 {
                    log::info!("[agent] context compacted: removed {removed} turns");
                    on_event(AgentEvent::ContextCompacted { turns_removed: removed });
                }
            }

            let body = json!({
                "model":       self.model_id,
                "messages":    messages,
                "tools":       tools,
                "tool_choice": "auto",
                "max_tokens":  4096,
            });

            let resp_json = match self
                .llm_call_with_retry(&self.client, &body, on_event, steps, &cancel)
                .await
            {
                Ok(v) => v,
                Err(LlmError::ContextLength(detail)) => {
                    // Context too long — compact aggressively and retry this step
                    log::info!("[agent] context length exceeded — compacting");
                    let removed = compact_context(&mut messages, self.config.compaction_keep);
                    if removed == 0 {
                        // Nothing left to compact — try trimming tool results
                        trim_tool_results(&mut messages, 512);
                        let removed2 = compact_context(&mut messages, self.config.compaction_keep);
                        if removed == 0 && removed2 == 0 {
                            return Err(format!(
                                "Context too long and cannot compact further. \
                                 Try a model with a larger context window. ({})",
                                truncate_str(&detail, 100)
                            ));
                        }
                    }
                    on_event(AgentEvent::ContextCompacted { turns_removed: removed });
                    steps -= 1; // retry this step
                    continue;
                }
                Err(LlmError::Other(e)) => return Err(e),
                Err(LlmError::Cancelled) => {
                    return Ok(AgentResponse {
                        content:       String::new(),
                        tokens_used:   cumulative_tokens,
                        steps,
                        finish_reason: FinishReason::Cancelled,
                    });
                }
            };

            if let Some(usage) = resp_json.get("usage") {
                cumulative_tokens += usage["total_tokens"].as_u64().unwrap_or(0) as u32;
            }

            let choice  = &resp_json["choices"][0];
            let message = &choice["message"];

            let content_text = message["content"].as_str().unwrap_or("");
            let has_tool_calls = message
                .get("tool_calls")
                .map_or(false, |tc| {
                    !tc.is_null() && tc.as_array().map_or(false, |a| !a.is_empty())
                });

            // Model returned a final text answer with no tool calls → done
            if !content_text.is_empty() && !has_tool_calls {
                return Ok(AgentResponse {
                    content:       content_text.to_string(),
                    tokens_used:   cumulative_tokens,
                    steps,
                    finish_reason: FinishReason::Stop,
                });
            }

            // Empty content and no tool calls → nudge the model to continue
            if content_text.is_empty() && !has_tool_calls {
                log::info!("[agent] step {steps}: empty response with no tool calls — nudging to continue");
                messages.push(ChatMessage {
                    role:         "assistant".into(),
                    content:      Some(String::new()),
                    tool_calls:   None,
                    tool_call_id: None,
                    name:         None,
                });
                messages.push(ChatMessage {
                    role:         "user".into(),
                    content:      Some("Continue with the task. Use your tools or provide a final answer.".into()),
                    tool_calls:   None,
                    tool_call_id: None,
                    name:         None,
                });
                continue;
            }

            if let Some(tool_calls) = message["tool_calls"].as_array() {
                if tool_calls.is_empty() {
                    // Shouldn't reach here after the checks above, but handle gracefully
                    continue;
                }

                messages.push(ChatMessage {
                    role:         "assistant".into(),
                    content:      message["content"].as_str().map(String::from),
                    tool_calls:   Some(tool_calls.clone()),
                    tool_call_id: None,
                    name:         None,
                });

                for tc in tool_calls {
                    // ── Cancellation check (before each tool) ────────────
                    if cancel.is_cancelled() {
                        return Ok(AgentResponse {
                            content:       String::new(),
                            tokens_used:   cumulative_tokens,
                            steps,
                            finish_reason: FinishReason::Cancelled,
                        });
                    }

                    let call_id = tc["id"].as_str().unwrap_or("").to_string();
                    let tool_id = tc["function"]["name"].as_str().unwrap_or("").to_string();
                    let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                    let args: Value = serde_json::from_str(args_str).unwrap_or(json!({}));

                    log::info!("[agent] tool call: {} args={}", tool_id, args_str);

                    on_event(AgentEvent::ToolCall {
                        step: steps,
                        tool_id: tool_id.clone(),
                        args: args.clone(),
                    });

                    let t0 = std::time::Instant::now();
                    // Race tool dispatch against cancellation
                    let result = tokio::select! {
                        r = self.dispatcher.dispatch(&tool_id, args) => r,
                        _ = cancel.cancelled() => {
                            return Ok(AgentResponse {
                                content:       String::new(),
                                tokens_used:   cumulative_tokens,
                                steps,
                                finish_reason: FinishReason::Cancelled,
                            });
                        }
                    };
                    let elapsed_ms = t0.elapsed().as_millis() as u64;

                    let result_str = match result {
                        Ok(dr) => {
                            for msg in &dr.wasm_logs {
                                on_event(AgentEvent::ToolLog {
                                    step:    steps,
                                    tool_id: tool_id.clone(),
                                    message: msg.clone(),
                                });
                            }
                            on_event(AgentEvent::ToolResult {
                                step:       steps,
                                tool_id:    tool_id.clone(),
                                ok:         true,
                                elapsed_ms,
                                summary:    summarize_result(&tool_id, &dr.output),
                            });
                            compress_tool_result(
                                &tool_id,
                                serde_json::to_string(&dr.output).unwrap_or_default(),
                                self.config.max_tool_result_chars,
                            )
                        }
                        Err(e) => {
                            on_event(AgentEvent::ToolResult {
                                step:       steps,
                                tool_id:    tool_id.clone(),
                                ok:         false,
                                elapsed_ms,
                                summary:    truncate_str(&e, 80),
                            });
                            format!("{{\"error\": \"{}\"}}", e.replace('"', "'"))
                        }
                    };

                    messages.push(ChatMessage {
                        role:         "tool".into(),
                        content:      Some(result_str),
                        tool_calls:   None,
                        tool_call_id: Some(call_id),
                        name:         Some(tool_id),
                    });
                }
            } else {
                return Ok(AgentResponse {
                    content:       message["content"].as_str().unwrap_or("").to_string(),
                    tokens_used:   cumulative_tokens,
                    steps,
                    finish_reason: FinishReason::Stop,
                });
            }
        }
    }

    async fn llm_call_with_retry(
        &self,
        client:   &reqwest::Client,
        body:     &Value,
        on_event: &mut (impl FnMut(AgentEvent) + Send),
        step:     usize,
        cancel:   &CancellationToken,
    ) -> Result<Value, LlmError> {
        let url          = format!("{}/v1/chat/completions", self.base_url);
        let max_attempts = self.config.max_retries + 1;
        let mut last_err = String::new();

        for attempt in 1..=max_attempts {
            if cancel.is_cancelled() {
                return Err(LlmError::Cancelled);
            }

            let mut req = client.post(&url).json(body);
            if let Some(key) = &self.api_key {
                req = req.header("Authorization", format!("Bearer {key}"));
            }

            // Race the HTTP request against cancellation
            let send_result = tokio::select! {
                r = req.send() => r,
                _ = cancel.cancelled() => {
                    return Err(LlmError::Cancelled);
                }
            };

            match send_result {
                Err(e) => {
                    last_err = format!("model request failed: {e}");
                    log::info!("[agent] attempt {attempt}/{max_attempts}: {last_err}");
                }
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        // Race body read against cancellation
                        let body_result = tokio::select! {
                            r = resp.json::<Value>() => r,
                            _ = cancel.cancelled() => {
                                return Err(LlmError::Cancelled);
                            }
                        };
                        return body_result
                            .map_err(|e| LlmError::Other(format!("model response parse failed: {e}")));
                    }

                    // Read the error body to detect context-length errors
                    let error_body = resp.text().await.unwrap_or_default();
                    log::info!(
                        "[agent] attempt {attempt}/{max_attempts}: HTTP {} — {}",
                        status.as_u16(),
                        truncate_str(&error_body, 200),
                    );

                    if is_context_length_error(status.as_u16(), &error_body) {
                        return Err(LlmError::ContextLength(error_body));
                    }

                    if status.as_u16() == 429 || status.is_server_error() {
                        last_err = format!("model HTTP {}: {}", status.as_u16(),
                            truncate_str(&error_body, 120));
                    } else {
                        return Err(LlmError::Other(format!(
                            "model HTTP {}: {}",
                            status.as_u16(),
                            truncate_str(&error_body, 200),
                        )));
                    }
                }
            }

            if attempt < max_attempts {
                let delay_ms = 1_000u64 << (attempt - 1);
                on_event(AgentEvent::Retrying { step, attempt, delay_ms });
                // Race retry sleep against cancellation
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_millis(delay_ms)) => {}
                    _ = cancel.cancelled() => {
                        return Err(LlmError::Cancelled);
                    }
                }
            }
        }

        Err(LlmError::Other(last_err))
    }

    fn build_tools_array(&self) -> Value {
        let tools: Vec<Value> = self
            .dispatcher
            .tool_schemas()
            .into_iter()
            .map(|t| json!({
                "type": "function",
                "function": {
                    "name":        t.id,
                    "description": t.description,
                    "parameters":  t.parameters,
                }
            }))
            .collect();
        Value::Array(tools)
    }
}

// ── LLM error classification ─────────────────────────────────────────────────

/// Distinguishes context-length errors (recoverable via compaction) from other
/// LLM failures so the agent loop can react accordingly.
enum LlmError {
    /// The model rejected the request because the context is too long.
    /// The agent loop should compact and retry.
    ContextLength(String),
    /// Any other error (network, auth, rate-limit exhausted, etc.).
    Other(String),
    /// The operation was cancelled by the user.
    Cancelled,
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::ContextLength(s) => write!(f, "context length exceeded: {}", truncate_str(s, 120)),
            LlmError::Other(s) => f.write_str(s),
            LlmError::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Detect whether an HTTP error response indicates a context-length overflow.
///
/// Different providers use different error formats:
/// - **llama.cpp**: HTTP 400, body contains `"content length"` or `"context length"`
fn is_context_length_error(status: u16, body: &str) -> bool {
    if status != 400 { return false; }
    let lower = body.to_ascii_lowercase();
    lower.contains("context_length_exceeded")
        || lower.contains("content length")
}

// ── Context compaction ────────────────────────────────────────────────────────

fn compact_context(messages: &mut Vec<ChatMessage>, keep: usize) -> usize {
    if messages.len() <= keep + 1 {
        return 0;
    }
    let mut cut_from = messages.len().saturating_sub(keep);

    // Ensure the kept portion contains at least one "user" message.
    // Many chat templates (llama.cpp Jinja, etc.) require a user message
    // and will error with "No user query found" if only system/assistant/tool
    // messages remain.
    let has_user_in_kept = messages[cut_from..].iter().any(|m| m.role == "user");
    if !has_user_in_kept {
        // Walk backwards from cut_from to find the nearest user message
        if let Some(pos) = messages[..cut_from].iter().rposition(|m| m.role == "user") {
            // Keep from this user message onward (but always skip system[0])
            cut_from = pos.max(1);
        }
    }

    if cut_from <= 1 {
        return 0; // nothing to compact (only system + user)
    }

    let removed = cut_from - 1;
    let system  = messages[0].clone();
    let dropped = &messages[1..cut_from];
    let note    = build_compact_note(dropped);

    // Use "user" role for the compact note so the message sequence is valid
    // for chat templates that require user→assistant alternation.
    let note_msg = ChatMessage {
        role:         "user".into(),
        content:      Some(note),
        tool_calls:   None,
        tool_call_id: None,
        name:         None,
    };

    let recent: Vec<ChatMessage> = messages[cut_from..].to_vec();
    *messages = [system, note_msg].into_iter().chain(recent).collect();
    removed
}

/// Truncate all tool result messages to at most `max_chars` characters.
/// This is a second-pass compaction that shrinks large tool outputs
/// (e.g. full web pages from http.fetch) when dropping turns alone
/// isn't enough to fit the context window.
fn trim_tool_results(messages: &mut [ChatMessage], max_chars: usize) {
    for msg in messages.iter_mut() {
        if msg.role == "tool" {
            if let Some(ref content) = msg.content {
                if content.len() > max_chars {
                    let trimmed: String = content.chars().take(max_chars).collect();
                    msg.content = Some(format!(
                        "{}…[trimmed from {} to {} chars]",
                        trimmed,
                        content.len(),
                        max_chars,
                    ));
                }
            }
        }
    }
}

fn build_compact_note(dropped: &[ChatMessage]) -> String {
    let mut lines = vec!["[Context compacted — earlier turns summary:]".to_string()];
    for msg in dropped {
        match msg.role.as_str() {
            "user" => {
                if let Some(c) = &msg.content {
                    lines.push(format!("User: {}", truncate_str(c, 120)));
                }
            }
            "assistant" => {
                if let Some(calls) = &msg.tool_calls {
                    for tc in calls {
                        let name = tc["function"]["name"].as_str().unwrap_or("?");
                        lines.push(format!("Called tool: {name}"));
                    }
                } else if let Some(c) = &msg.content {
                    if !c.trim().is_empty() {
                        lines.push(format!("Assistant: {}", truncate_str(c, 120)));
                    }
                }
            }
            "tool" => {
                let name = msg.name.as_deref().unwrap_or("?");
                if let Some(c) = &msg.content {
                    lines.push(format!("  {name} → {}", truncate_str(c, 200)));
                }
            }
            _ => {}
        }
    }
    lines.join("\n")
}

fn build_system_prompt() -> String {
    "You are a helpful AI assistant with access to tools. You can search the web, \
     fetch URLs, and execute JavaScript code in a sandbox.\n\n\
     ## Tool usage guidelines\n\
     - **web.search**: Use when you need current information, facts, news, weather, \
       prices, or anything that might have changed recently. Always search before \
       saying you don't know something.\n\
     - **http.fetch**: Use to read specific web pages, API endpoints, or JSON data. \
       HTML is automatically converted to readable text.\n\
     - **code.exec**: Use to compute results, parse data, do math, format output, \
       or process information. The sandbox has httpGet() for HTTP requests and \
       Date.now() for timestamps. No filesystem or environment access.\n\n\
     ## Important rules\n\
     - When asked about current events, weather, prices, or time-sensitive data: \
       ALWAYS use web.search or http.fetch first.\n\
     - Show your work: explain what you found and cite sources.\n\
     - If a tool call fails, try an alternative approach before giving up.\n\
     - Be concise but thorough. Give direct answers, not just search results.\n\
     - When doing calculations, use code.exec to ensure accuracy."
        .to_string()
}
