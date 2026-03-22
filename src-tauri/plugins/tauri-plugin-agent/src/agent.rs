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

            let resp_json = self
                .llm_call_with_retry(&self.client, &body, on_event, steps)
                .await?;

            if let Some(usage) = resp_json.get("usage") {
                cumulative_tokens += usage["total_tokens"].as_u64().unwrap_or(0) as u32;
            }

            let choice  = &resp_json["choices"][0];
            let message = &choice["message"];

            if let Some(content) = message["content"].as_str() {
                let no_tool_calls = message
                    .get("tool_calls")
                    .map_or(true, |tc| tc.is_null()
                        || tc.as_array().map_or(true, |a| a.is_empty()));

                if !content.is_empty() && no_tool_calls {
                    return Ok(AgentResponse {
                        content:       content.to_string(),
                        tokens_used:   cumulative_tokens,
                        steps,
                        finish_reason: FinishReason::Stop,
                    });
                }
            }

            if let Some(tool_calls) = message["tool_calls"].as_array() {
                if tool_calls.is_empty() {
                    return Ok(AgentResponse {
                        content:       message["content"].as_str().unwrap_or("").to_string(),
                        tokens_used:   cumulative_tokens,
                        steps,
                        finish_reason: FinishReason::Stop,
                    });
                }

                messages.push(ChatMessage {
                    role:         "assistant".into(),
                    content:      message["content"].as_str().map(String::from),
                    tool_calls:   Some(tool_calls.clone()),
                    tool_call_id: None,
                    name:         None,
                });

                for tc in tool_calls {
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

                    let t0         = std::time::Instant::now();
                    let result     = self.dispatcher.dispatch(&tool_id, args).await;
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
    ) -> Result<Value, String> {
        let url          = format!("{}/v1/chat/completions", self.base_url);
        let max_attempts = self.config.max_retries + 1;
        let mut last_err = String::new();

        for attempt in 1..=max_attempts {
            let mut req = client.post(&url).json(body);
            if let Some(key) = &self.api_key {
                req = req.header("Authorization", format!("Bearer {key}"));
            }
            match req.send().await {
                Err(e) => {
                    last_err = format!("model request failed: {e}");
                    log::warn!("[agent] attempt {attempt}/{max_attempts}: {last_err}");
                }
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return resp.json::<Value>().await
                            .map_err(|e| format!("model response parse failed: {e}"));
                    }
                    if status.as_u16() == 429 || status.is_server_error() {
                        last_err = format!("model HTTP {}", status.as_u16());
                        log::warn!("[agent] attempt {attempt}/{max_attempts}: {last_err}");
                    } else {
                        return Err(format!("model HTTP {}", status.as_u16()));
                    }
                }
            }

            if attempt < max_attempts {
                let delay_ms = 1_000u64 << (attempt - 1);
                on_event(AgentEvent::Retrying { step, attempt, delay_ms });
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
        }

        Err(last_err)
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

// ── Context compaction ────────────────────────────────────────────────────────

fn compact_context(messages: &mut Vec<ChatMessage>, keep: usize) -> usize {
    if messages.len() <= keep + 1 {
        return 0;
    }
    let cut_from = messages.len().saturating_sub(keep);
    let removed  = cut_from - 1;

    let system  = messages[0].clone();
    let dropped = &messages[1..cut_from];
    let note    = build_compact_note(dropped);

    let note_msg = ChatMessage {
        role:         "system".into(),
        content:      Some(note),
        tool_calls:   None,
        tool_call_id: None,
        name:         None,
    };

    let recent: Vec<ChatMessage> = messages[cut_from..].to_vec();
    *messages = [system, note_msg].into_iter().chain(recent).collect();
    removed
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
    format!(
        r#"You are a helpful assistant with access to tools. Use code.exec to run JavaScript when you need to fetch data, compute, or read/write files. Output results with console.log().

JS globals: httpGet(url), JSON.parse(), JSON.stringify(), readFile(path), writeFile(path,content), formatDate(ms?), console.log().
Do NOT use fetch(), require(), import, async/await, or Promise."#
    )
}
