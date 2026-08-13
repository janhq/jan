//! Translating-gateway support for the proxy.
//!
//! Jan's proxy accepts OpenAI chat/completions and, for OpenAI-compatible
//! upstreams, forwards verbatim. To also front providers with a different
//! native wire API (OpenAI `/v1/responses`, Google `generateContent`,
//! Anthropic `/v1/messages`), each such provider gets a converter that rewrites
//! the request and translates the response back to chat/completions.
//!
//! This module currently provides the shared primitive every converter needs:
//! an [`SseAccumulator`] that reassembles complete Server-Sent Events across
//! network chunk boundaries. The existing inline proxy parser splits each chunk
//! on lines and drops partial lines, which only survives because upstreams tend
//! to flush whole events; a real translator cannot rely on that.

/// One parsed Server-Sent Event.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SseEvent {
    /// The `event:` field value, empty when absent (chat/completions omits it;
    /// OpenAI `/responses` and Anthropic set it).
    pub event: String,
    /// Concatenated `data:` payload (multiple `data:` lines joined by `\n`),
    /// with sentinels like `[DONE]` preserved verbatim.
    pub data: String,
}

/// Accumulates raw response text and yields complete SSE events, buffering any
/// partial trailing event until its terminating blank line arrives in a later
/// chunk.
#[derive(Debug, Default)]
pub struct SseAccumulator {
    buf: String,
}

impl SseAccumulator {
    pub fn new() -> Self {
        Self { buf: String::new() }
    }

    /// Feed a chunk of the response body; returns every event completed by it.
    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        // Normalize CRLF so boundary detection only has to look for "\n\n".
        self.buf.push_str(&chunk.replace("\r\n", "\n"));
        let mut events = Vec::new();
        while let Some(idx) = self.buf.find("\n\n") {
            let raw: String = self.buf.drain(..idx + 2).collect();
            if let Some(ev) = parse_event(&raw) {
                events.push(ev);
            }
        }
        events
    }

    /// Flush a final event that arrived without a terminating blank line (some
    /// servers omit it before closing the connection).
    pub fn finish(&mut self) -> Option<SseEvent> {
        let raw = std::mem::take(&mut self.buf);
        parse_event(&raw)
    }
}

fn parse_event(raw: &str) -> Option<SseEvent> {
    let mut ev = SseEvent::default();
    let mut data_lines: Vec<&str> = Vec::new();
    let mut has_field = false;
    for line in raw.lines() {
        // Blank lines separate events; lines starting with ':' are comments.
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
            has_field = true;
        } else if let Some(rest) = line.strip_prefix("event:") {
            ev.event = rest.strip_prefix(' ').unwrap_or(rest).to_string();
            has_field = true;
        }
        // `id:`, `retry:`, and unknown fields are irrelevant to translation.
    }
    if !has_field {
        return None;
    }
    ev.data = data_lines.join("\n");
    Some(ev)
}

use serde_json::{json, Value};
use std::collections::HashMap;

/// Translates an OpenAI chat/completions request to a provider's native wire
/// API and its response back. Implementors front a provider whose native API is
/// not chat/completions (OpenAI `/v1/responses`, Google `generateContent`,
/// Anthropic `/v1/messages`); the proxy selects one by `ProviderConfig.api_type`
/// and otherwise forwards verbatim.
pub trait UpstreamConverter: Send + Sync {
    /// Path suffix appended to the provider `base_url`. Derived from the request
    /// body because some APIs encode the model and action in the URL (Google:
    /// `/models/{model}:streamGenerateContent?alt=sse`).
    fn upstream_path(&self, body: &Value) -> String;

    /// Authorization header for the upstream request. Defaults to OpenAI-style
    /// `Authorization: Bearer`; providers using a different scheme (Google:
    /// `x-goog-api-key`) override this.
    fn auth_header(&self, key: &str) -> (&'static str, String) {
        ("authorization", format!("Bearer {key}"))
    }

    /// Fixed headers the native API requires (Anthropic: `anthropic-version`).
    fn extra_headers(&self) -> Vec<(&'static str, &'static str)> {
        Vec::new()
    }

    /// Rewrite the inbound chat/completions body into the native request body.
    fn convert_request(&self, body: &Value) -> Value;

    /// Translate a non-streaming native response into a chat.completion object.
    fn convert_response(&self, upstream: &Value) -> Value;

    /// Translate one native SSE event into zero or more chat/completions SSE
    /// `data:` payloads (each a JSON chunk string, or the literal `[DONE]`).
    fn convert_stream_event(&self, event: &SseEvent, state: &mut StreamState) -> Vec<String>;
}

/// Select the converter for a provider's `api_type`. `None`, `"openai"`, and
/// unknown values keep the verbatim chat/completions passthrough.
pub fn converter_for(api_type: Option<&str>) -> Option<Box<dyn UpstreamConverter>> {
    match api_type {
        Some("openai-responses") => Some(Box::new(OpenAIResponsesConverter::new())),
        Some("google") => Some(Box::new(GoogleGenerateContentConverter::new())),
        Some("anthropic") => Some(Box::new(AnthropicMessagesConverter::new())),
        _ => None,
    }
}

/// Per-stream translation state threaded across `convert_stream_event` calls.
#[derive(Debug, Default)]
pub struct StreamState {
    pub id: String,
    pub model: String,
    pub created: i64,
    pub role_sent: bool,
    pub saw_tool_call: bool,
    /// native item/call id -> chat tool_calls array index.
    pub tool_index: HashMap<String, usize>,
    pub next_tool_index: usize,
    pub finished: bool,
    /// Prompt tokens captured early (Anthropic sends them in `message_start`).
    pub input_tokens: i64,
}

/// Fronts OpenAI's `/v1/responses` API, exposing it as chat/completions so the
/// proxy's OpenAI-SDK clients get reasoning summaries (`reasoning_content`)
/// without switching wire formats.
#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAIResponsesConverter;

impl OpenAIResponsesConverter {
    pub fn new() -> Self {
        Self
    }
}

/// Extract plain text from a chat message `content` (string or content-part array).
fn message_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

impl UpstreamConverter for OpenAIResponsesConverter {
    fn upstream_path(&self, _body: &Value) -> String {
        "/responses".to_string()
    }

    fn convert_request(&self, body: &Value) -> Value {
        let mut out = json!({});
        if let Some(model) = body.get("model") {
            out["model"] = model.clone();
        }

        // Split system/developer messages into `instructions`; the rest become
        // `input` items (Responses accepts chat-shaped {role, content}).
        let mut instructions: Vec<String> = Vec::new();
        let mut input_items: Vec<Value> = Vec::new();
        if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
            for msg in messages {
                let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
                let content = msg.get("content").cloned().unwrap_or(Value::Null);
                match role {
                    "system" | "developer" => instructions.push(message_text(&content)),
                    "tool" => {
                        // Chat tool result -> Responses function_call_output item.
                        input_items.push(json!({
                            "type": "function_call_output",
                            "call_id": msg.get("tool_call_id").cloned().unwrap_or(Value::Null),
                            "output": message_text(&content),
                        }));
                    }
                    "assistant" if msg.get("tool_calls").is_some() => {
                        if let Some(calls) = msg.get("tool_calls").and_then(|c| c.as_array()) {
                            for call in calls {
                                let func = call.get("function");
                                input_items.push(json!({
                                    "type": "function_call",
                                    "call_id": call.get("id").cloned().unwrap_or(Value::Null),
                                    "name": func.and_then(|f| f.get("name")).cloned().unwrap_or(Value::Null),
                                    "arguments": func.and_then(|f| f.get("arguments")).cloned().unwrap_or(Value::String(String::new())),
                                }));
                            }
                        }
                        let text = message_text(&content);
                        if !text.is_empty() {
                            input_items.push(json!({"role": "assistant", "content": text}));
                        }
                    }
                    _ => input_items.push(json!({"role": role, "content": message_text(&content)})),
                }
            }
        }
        if !instructions.is_empty() {
            out["instructions"] = json!(instructions.join("\n\n"));
        }
        out["input"] = json!(input_items);

        for (src, dst) in [
            ("max_tokens", "max_output_tokens"),
            ("max_completion_tokens", "max_output_tokens"),
        ] {
            if let Some(v) = body.get(src) {
                out[dst] = v.clone();
            }
        }
        for key in ["temperature", "top_p", "stream"] {
            if let Some(v) = body.get(key) {
                out[key] = v.clone();
            }
        }

        if let Some(effort) = body.get("reasoning_effort").and_then(|e| e.as_str()) {
            out["reasoning"] = json!({"effort": effort, "summary": "auto"});
        }

        if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
            let flattened: Vec<Value> = tools
                .iter()
                .filter_map(|t| {
                    let func = t.get("function")?;
                    Some(json!({
                        "type": "function",
                        "name": func.get("name").cloned().unwrap_or(Value::Null),
                        "description": func.get("description").cloned().unwrap_or(Value::Null),
                        "parameters": func.get("parameters").cloned().unwrap_or(json!({})),
                    }))
                })
                .collect();
            out["tools"] = json!(flattened);
        }
        if let Some(tc) = body.get("tool_choice") {
            out["tool_choice"] = tc.clone();
        }

        out
    }

    fn convert_response(&self, upstream: &Value) -> Value {
        let mut content = String::new();
        let mut reasoning = String::new();
        let mut tool_calls: Vec<Value> = Vec::new();

        if let Some(output) = upstream.get("output").and_then(|o| o.as_array()) {
            for item in output {
                match item.get("type").and_then(|t| t.as_str()) {
                    Some("message") => {
                        if let Some(parts) = item.get("content").and_then(|c| c.as_array()) {
                            for part in parts {
                                if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                                    content.push_str(t);
                                }
                            }
                        }
                    }
                    Some("reasoning") => {
                        if let Some(parts) = item.get("summary").and_then(|s| s.as_array()) {
                            for part in parts {
                                if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                                    reasoning.push_str(t);
                                }
                            }
                        }
                    }
                    Some("function_call") => {
                        tool_calls.push(json!({
                            "id": item.get("call_id").cloned().unwrap_or(Value::Null),
                            "type": "function",
                            "function": {
                                "name": item.get("name").cloned().unwrap_or(Value::Null),
                                "arguments": item.get("arguments").cloned().unwrap_or(Value::String(String::new())),
                            }
                        }));
                    }
                    _ => {}
                }
            }
        }

        let mut message = json!({"role": "assistant"});
        message["content"] = if content.is_empty() && !tool_calls.is_empty() {
            Value::Null
        } else {
            json!(content)
        };
        if !reasoning.is_empty() {
            message["reasoning_content"] = json!(reasoning);
        }
        let finish_reason = if !tool_calls.is_empty() {
            message["tool_calls"] = json!(tool_calls);
            "tool_calls"
        } else {
            "stop"
        };

        json!({
            "id": upstream.get("id").cloned().unwrap_or_else(|| json!("chatcmpl-proxy")),
            "object": "chat.completion",
            "created": upstream.get("created_at").cloned().unwrap_or_else(|| json!(0)),
            "model": upstream.get("model").cloned().unwrap_or(Value::Null),
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }],
            "usage": convert_usage(upstream.get("usage")),
        })
    }

    fn convert_stream_event(&self, event: &SseEvent, state: &mut StreamState) -> Vec<String> {
        if event.data == "[DONE]" || state.finished {
            return Vec::new();
        }
        let data: Value = match serde_json::from_str(&event.data) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };
        let kind = if event.event.is_empty() {
            data.get("type").and_then(|t| t.as_str()).unwrap_or("")
        } else {
            event.event.as_str()
        };

        let mut out: Vec<String> = Vec::new();
        match kind {
            "response.created" | "response.in_progress" => {
                if let Some(resp) = data.get("response") {
                    if let Some(id) = resp.get("id").and_then(|v| v.as_str()) {
                        state.id = id.to_string();
                    }
                    if let Some(model) = resp.get("model").and_then(|v| v.as_str()) {
                        state.model = model.to_string();
                    }
                    if let Some(created) = resp.get("created_at").and_then(|v| v.as_i64()) {
                        state.created = created;
                    }
                }
            }
            "response.output_text.delta" => {
                if let Some(text) = data.get("delta").and_then(|d| d.as_str()) {
                    push_role_chunk(state, &mut out);
                    out.push(chunk_str(state, json!({"content": text}), None));
                }
            }
            "response.reasoning_summary_text.delta" => {
                if let Some(text) = data.get("delta").and_then(|d| d.as_str()) {
                    push_role_chunk(state, &mut out);
                    out.push(chunk_str(state, json!({"reasoning_content": text}), None));
                }
            }
            "response.output_item.added" => {
                if let Some(item) = data.get("item") {
                    if item.get("type").and_then(|t| t.as_str()) == Some("function_call") {
                        let key = item
                            .get("id")
                            .and_then(|v| v.as_str())
                            .or_else(|| item.get("call_id").and_then(|v| v.as_str()))
                            .unwrap_or("")
                            .to_string();
                        let idx = state.next_tool_index;
                        state.next_tool_index += 1;
                        state.tool_index.insert(key, idx);
                        state.saw_tool_call = true;
                        push_role_chunk(state, &mut out);
                        out.push(chunk_str(
                            state,
                            json!({"tool_calls": [{
                                "index": idx,
                                "id": item.get("call_id").cloned().unwrap_or(Value::Null),
                                "type": "function",
                                "function": {
                                    "name": item.get("name").cloned().unwrap_or(Value::Null),
                                    "arguments": "",
                                }
                            }]}),
                            None,
                        ));
                    }
                }
            }
            "response.function_call_arguments.delta" => {
                let key = data
                    .get("item_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(delta) = data.get("delta").and_then(|d| d.as_str()) {
                    let idx = *state.tool_index.get(&key).unwrap_or(&0);
                    out.push(chunk_str(
                        state,
                        json!({"tool_calls": [{
                            "index": idx,
                            "function": {"arguments": delta}
                        }]}),
                        None,
                    ));
                }
            }
            "response.completed" | "response.incomplete" => {
                let finish = if state.saw_tool_call { "tool_calls" } else { "stop" };
                let usage = data
                    .get("response")
                    .and_then(|r| r.get("usage"))
                    .map(|u| convert_usage(Some(u)))
                    .filter(|u| !u.is_null());
                out.push(chunk_str_with_usage(state, json!({}), Some(finish), usage.as_ref()));
                out.push("[DONE]".to_string());
                state.finished = true;
            }
            "response.failed" | "error" => {
                let message = data
                    .get("response")
                    .and_then(|r| r.get("error"))
                    .or_else(|| data.get("error"))
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("upstream error");
                out.push(json!({"error": {"message": message}}).to_string());
                out.push("[DONE]".to_string());
                state.finished = true;
            }
            _ => {}
        }
        out
    }
}

/// Fronts Google's Gemini `generateContent` API. The model and action are
/// encoded in the URL and streaming uses `?alt=sse`; auth is `x-goog-api-key`.
/// The registered provider `base_url` must include the API version, e.g.
/// `https://generativelanguage.googleapis.com/v1beta`.
#[derive(Debug, Default, Clone, Copy)]
pub struct GoogleGenerateContentConverter;

impl GoogleGenerateContentConverter {
    pub fn new() -> Self {
        Self
    }
}

/// Map a Gemini `finishReason` to a chat/completions `finish_reason`.
fn map_gemini_finish(reason: &str, saw_tool: bool) -> &'static str {
    if saw_tool {
        return "tool_calls";
    }
    match reason {
        "MAX_TOKENS" => "length",
        "SAFETY" | "RECITATION" | "PROHIBITED_CONTENT" | "BLOCKLIST" => "content_filter",
        _ => "stop",
    }
}

/// Map Gemini `usageMetadata` to chat/completions usage.
fn convert_gemini_usage(usage: Option<&Value>) -> Value {
    let Some(u) = usage else {
        return Value::Null;
    };
    let prompt = u.get("promptTokenCount").and_then(|v| v.as_i64()).unwrap_or(0);
    let candidates = u
        .get("candidatesTokenCount")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let thoughts = u.get("thoughtsTokenCount").and_then(|v| v.as_i64()).unwrap_or(0);
    let completion = candidates + thoughts;
    let total = u
        .get("totalTokenCount")
        .and_then(|v| v.as_i64())
        .unwrap_or(prompt + completion);
    json!({
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    })
}

impl UpstreamConverter for GoogleGenerateContentConverter {
    fn upstream_path(&self, body: &Value) -> String {
        let model = body.get("model").and_then(|m| m.as_str()).unwrap_or("");
        let streaming = body.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
        if streaming {
            format!("/models/{model}:streamGenerateContent?alt=sse")
        } else {
            format!("/models/{model}:generateContent")
        }
    }

    fn auth_header(&self, key: &str) -> (&'static str, String) {
        ("x-goog-api-key", key.to_string())
    }

    fn convert_request(&self, body: &Value) -> Value {
        // tool_call_id -> function name, so tool results become functionResponse
        // parts (Gemini keys them by name, not call id).
        let mut call_names: HashMap<String, String> = HashMap::new();
        if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
            for msg in messages {
                if let Some(calls) = msg.get("tool_calls").and_then(|c| c.as_array()) {
                    for call in calls {
                        if let (Some(id), Some(name)) = (
                            call.get("id").and_then(|v| v.as_str()),
                            call.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()),
                        ) {
                            call_names.insert(id.to_string(), name.to_string());
                        }
                    }
                }
            }
        }

        let mut contents: Vec<Value> = Vec::new();
        let mut system_parts: Vec<Value> = Vec::new();
        if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
            for msg in messages {
                let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
                let content = msg.get("content").cloned().unwrap_or(Value::Null);
                match role {
                    "system" | "developer" => {
                        system_parts.push(json!({"text": message_text(&content)}));
                    }
                    "assistant" => {
                        let mut parts: Vec<Value> = Vec::new();
                        let text = message_text(&content);
                        if !text.is_empty() {
                            parts.push(json!({"text": text}));
                        }
                        if let Some(calls) = msg.get("tool_calls").and_then(|c| c.as_array()) {
                            for call in calls {
                                let func = call.get("function");
                                let name = func.and_then(|f| f.get("name")).cloned().unwrap_or(Value::Null);
                                let args_str = func
                                    .and_then(|f| f.get("arguments"))
                                    .and_then(|a| a.as_str())
                                    .unwrap_or("{}");
                                let args: Value = serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
                                parts.push(json!({"functionCall": {"name": name, "args": args}}));
                            }
                        }
                        if !parts.is_empty() {
                            contents.push(json!({"role": "model", "parts": parts}));
                        }
                    }
                    "tool" => {
                        let call_id = msg.get("tool_call_id").and_then(|v| v.as_str()).unwrap_or("");
                        let name = call_names.get(call_id).cloned().unwrap_or_else(|| call_id.to_string());
                        let text = message_text(&content);
                        // Gemini requires the functionResponse `response` to be an object.
                        let response: Value = serde_json::from_str(&text)
                            .ok()
                            .filter(|v: &Value| v.is_object())
                            .unwrap_or_else(|| json!({"result": text}));
                        contents.push(json!({
                            "role": "user",
                            "parts": [{"functionResponse": {"name": name, "response": response}}]
                        }));
                    }
                    _ => contents.push(json!({"role": "user", "parts": [{"text": message_text(&content)}]})),
                }
            }
        }

        let mut out = json!({"contents": contents});
        if !system_parts.is_empty() {
            out["systemInstruction"] = json!({"parts": system_parts});
        }

        let mut gen_config = json!({});
        if let Some(v) = body.get("temperature") {
            gen_config["temperature"] = v.clone();
        }
        if let Some(v) = body.get("top_p") {
            gen_config["topP"] = v.clone();
        }
        if let Some(v) = body.get("max_tokens").or_else(|| body.get("max_completion_tokens")) {
            gen_config["maxOutputTokens"] = v.clone();
        }
        if body.get("reasoning_effort").and_then(|e| e.as_str()).is_some() {
            gen_config["thinkingConfig"] = json!({"thinkingBudget": -1, "includeThoughts": true});
        }
        if gen_config.as_object().is_some_and(|o| !o.is_empty()) {
            out["generationConfig"] = gen_config;
        }

        if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
            let decls: Vec<Value> = tools
                .iter()
                .filter_map(|t| {
                    let func = t.get("function")?;
                    Some(json!({
                        "name": func.get("name").cloned().unwrap_or(Value::Null),
                        "description": func.get("description").cloned().unwrap_or(Value::Null),
                        "parameters": func.get("parameters").cloned().unwrap_or(json!({})),
                    }))
                })
                .collect();
            if !decls.is_empty() {
                out["tools"] = json!([{"functionDeclarations": decls}]);
            }
        }
        if let Some(mode) = body.get("tool_choice").and_then(|c| c.as_str()) {
            let g_mode = match mode {
                "none" => "NONE",
                "required" => "ANY",
                _ => "AUTO",
            };
            out["toolConfig"] = json!({"functionCallingConfig": {"mode": g_mode}});
        }

        out
    }

    fn convert_response(&self, upstream: &Value) -> Value {
        let candidate = upstream
            .get("candidates")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first());
        let mut content = String::new();
        let mut reasoning = String::new();
        let mut tool_calls: Vec<Value> = Vec::new();

        if let Some(parts) = candidate
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
        {
            for part in parts {
                if let Some(fc) = part.get("functionCall") {
                    let args = fc.get("args").cloned().unwrap_or_else(|| json!({}));
                    tool_calls.push(json!({
                        "id": format!("call_{}", tool_calls.len()),
                        "type": "function",
                        "function": {
                            "name": fc.get("name").cloned().unwrap_or(Value::Null),
                            "arguments": serde_json::to_string(&args).unwrap_or_default(),
                        }
                    }));
                } else if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    if part.get("thought").and_then(|t| t.as_bool()).unwrap_or(false) {
                        reasoning.push_str(text);
                    } else {
                        content.push_str(text);
                    }
                }
            }
        }

        let mut message = json!({"role": "assistant"});
        message["content"] = if content.is_empty() && !tool_calls.is_empty() {
            Value::Null
        } else {
            json!(content)
        };
        if !reasoning.is_empty() {
            message["reasoning_content"] = json!(reasoning);
        }
        let saw_tool = !tool_calls.is_empty();
        if saw_tool {
            message["tool_calls"] = json!(tool_calls);
        }
        let finish_reason = map_gemini_finish(
            candidate
                .and_then(|c| c.get("finishReason"))
                .and_then(|r| r.as_str())
                .unwrap_or("STOP"),
            saw_tool,
        );

        json!({
            "id": upstream.get("responseId").cloned().unwrap_or_else(|| json!("chatcmpl-proxy")),
            "object": "chat.completion",
            "created": 0,
            "model": upstream.get("modelVersion").cloned().unwrap_or(Value::Null),
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }],
            "usage": convert_gemini_usage(upstream.get("usageMetadata")),
        })
    }

    fn convert_stream_event(&self, event: &SseEvent, state: &mut StreamState) -> Vec<String> {
        if event.data == "[DONE]" || state.finished {
            return Vec::new();
        }
        let data: Value = match serde_json::from_str(&event.data) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };
        if let Some(model) = data.get("modelVersion").and_then(|v| v.as_str()) {
            if state.model.is_empty() {
                state.model = model.to_string();
            }
        }
        if let Some(id) = data.get("responseId").and_then(|v| v.as_str()) {
            if state.id.is_empty() {
                state.id = id.to_string();
            }
        }

        let mut out: Vec<String> = Vec::new();
        let candidate = data
            .get("candidates")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first());

        if let Some(parts) = candidate
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
        {
            for part in parts {
                if let Some(fc) = part.get("functionCall") {
                    let idx = state.next_tool_index;
                    state.next_tool_index += 1;
                    state.saw_tool_call = true;
                    push_role_chunk(state, &mut out);
                    let args = fc.get("args").cloned().unwrap_or_else(|| json!({}));
                    out.push(chunk_str(
                        state,
                        json!({"tool_calls": [{
                            "index": idx,
                            "id": format!("call_{idx}"),
                            "type": "function",
                            "function": {
                                "name": fc.get("name").cloned().unwrap_or(Value::Null),
                                "arguments": serde_json::to_string(&args).unwrap_or_default(),
                            }
                        }]}),
                        None,
                    ));
                } else if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    push_role_chunk(state, &mut out);
                    let key = if part.get("thought").and_then(|t| t.as_bool()).unwrap_or(false) {
                        "reasoning_content"
                    } else {
                        "content"
                    };
                    out.push(chunk_str(state, json!({ key: text }), None));
                }
            }
        }

        if let Some(reason) = candidate.and_then(|c| c.get("finishReason")).and_then(|r| r.as_str()) {
            let finish = map_gemini_finish(reason, state.saw_tool_call);
            let usage = data
                .get("usageMetadata")
                .map(|u| convert_gemini_usage(Some(u)))
                .filter(|u| !u.is_null());
            out.push(chunk_str_with_usage(state, json!({}), Some(finish), usage.as_ref()));
            out.push("[DONE]".to_string());
            state.finished = true;
        }
        out
    }
}

/// Anthropic requires a `max_tokens`; chat/completions may omit it.
const ANTHROPIC_DEFAULT_MAX_TOKENS: i64 = 4096;

/// Fronts Anthropic's `/v1/messages` API. Auth is `x-api-key` plus a fixed
/// `anthropic-version` header. The registered provider `base_url` should include
/// the version prefix, e.g. `https://api.anthropic.com/v1`.
#[derive(Debug, Default, Clone, Copy)]
pub struct AnthropicMessagesConverter;

impl AnthropicMessagesConverter {
    pub fn new() -> Self {
        Self
    }
}

fn map_anthropic_finish(reason: &str, saw_tool: bool) -> &'static str {
    if saw_tool {
        return "tool_calls";
    }
    match reason {
        "max_tokens" => "length",
        "tool_use" => "tool_calls",
        "refusal" => "content_filter",
        _ => "stop",
    }
}

fn anthropic_usage(input_tokens: i64, output_tokens: i64) -> Value {
    json!({
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    })
}

/// Append `blocks` to the last message when it shares `role`, else start a new
/// one. Anthropic rejects consecutive same-role messages, so tool results and
/// adjacent turns must be merged.
fn push_merged(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(|r| r.as_str()) == Some(role) {
            if let Some(arr) = last.get_mut("content").and_then(|c| c.as_array_mut()) {
                arr.extend(blocks);
                return;
            }
        }
    }
    messages.push(json!({"role": role, "content": blocks}));
}

impl UpstreamConverter for AnthropicMessagesConverter {
    fn upstream_path(&self, _body: &Value) -> String {
        "/messages".to_string()
    }

    fn auth_header(&self, key: &str) -> (&'static str, String) {
        ("x-api-key", key.to_string())
    }

    fn extra_headers(&self) -> Vec<(&'static str, &'static str)> {
        vec![("anthropic-version", "2023-06-01")]
    }

    fn convert_request(&self, body: &Value) -> Value {
        let mut out = json!({});
        if let Some(model) = body.get("model") {
            out["model"] = model.clone();
        }
        let max_tokens = body
            .get("max_tokens")
            .or_else(|| body.get("max_completion_tokens"))
            .and_then(|v| v.as_i64())
            .unwrap_or(ANTHROPIC_DEFAULT_MAX_TOKENS);
        out["max_tokens"] = json!(max_tokens);
        for key in ["temperature", "top_p", "stream"] {
            if let Some(v) = body.get(key) {
                out[key] = v.clone();
            }
        }

        let mut system: Vec<String> = Vec::new();
        let mut messages: Vec<Value> = Vec::new();
        if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
            for msg in msgs {
                let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
                let content = msg.get("content").cloned().unwrap_or(Value::Null);
                match role {
                    "system" | "developer" => system.push(message_text(&content)),
                    "assistant" => {
                        let mut blocks: Vec<Value> = Vec::new();
                        let text = message_text(&content);
                        if !text.is_empty() {
                            blocks.push(json!({"type": "text", "text": text}));
                        }
                        if let Some(calls) = msg.get("tool_calls").and_then(|c| c.as_array()) {
                            for call in calls {
                                let func = call.get("function");
                                let args_str = func
                                    .and_then(|f| f.get("arguments"))
                                    .and_then(|a| a.as_str())
                                    .unwrap_or("{}");
                                let input: Value = serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
                                blocks.push(json!({
                                    "type": "tool_use",
                                    "id": call.get("id").cloned().unwrap_or(Value::Null),
                                    "name": func.and_then(|f| f.get("name")).cloned().unwrap_or(Value::Null),
                                    "input": input,
                                }));
                            }
                        }
                        push_merged(&mut messages, "assistant", blocks);
                    }
                    "tool" => {
                        push_merged(
                            &mut messages,
                            "user",
                            vec![json!({
                                "type": "tool_result",
                                "tool_use_id": msg.get("tool_call_id").cloned().unwrap_or(Value::Null),
                                "content": message_text(&content),
                            })],
                        );
                    }
                    _ => push_merged(
                        &mut messages,
                        "user",
                        vec![json!({"type": "text", "text": message_text(&content)})],
                    ),
                }
            }
        }
        out["messages"] = json!(messages);
        if !system.is_empty() {
            out["system"] = json!(system.join("\n\n"));
        }

        if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
            let mapped: Vec<Value> = tools
                .iter()
                .filter_map(|t| {
                    let func = t.get("function")?;
                    Some(json!({
                        "name": func.get("name").cloned().unwrap_or(Value::Null),
                        "description": func.get("description").cloned().unwrap_or(Value::Null),
                        "input_schema": func.get("parameters").cloned().unwrap_or(json!({"type": "object"})),
                    }))
                })
                .collect();
            if !mapped.is_empty() {
                out["tools"] = json!(mapped);
            }
        }
        if let Some(tc) = body.get("tool_choice") {
            out["tool_choice"] = match tc.as_str() {
                Some("none") => json!({"type": "none"}),
                Some("required") => json!({"type": "any"}),
                Some("auto") => json!({"type": "auto"}),
                _ => {
                    // {"type":"function","function":{"name":...}} -> {"type":"tool","name":...}
                    match tc.get("function").and_then(|f| f.get("name")) {
                        Some(name) => json!({"type": "tool", "name": name}),
                        None => json!({"type": "auto"}),
                    }
                }
            };
        }

        out
    }

    fn convert_response(&self, upstream: &Value) -> Value {
        let mut content = String::new();
        let mut reasoning = String::new();
        let mut tool_calls: Vec<Value> = Vec::new();

        if let Some(blocks) = upstream.get("content").and_then(|c| c.as_array()) {
            for block in blocks {
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                            content.push_str(t);
                        }
                    }
                    Some("thinking") => {
                        if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) {
                            reasoning.push_str(t);
                        }
                    }
                    Some("tool_use") => {
                        let input = block.get("input").cloned().unwrap_or_else(|| json!({}));
                        tool_calls.push(json!({
                            "id": block.get("id").cloned().unwrap_or(Value::Null),
                            "type": "function",
                            "function": {
                                "name": block.get("name").cloned().unwrap_or(Value::Null),
                                "arguments": serde_json::to_string(&input).unwrap_or_default(),
                            }
                        }));
                    }
                    _ => {}
                }
            }
        }

        let mut message = json!({"role": "assistant"});
        let saw_tool = !tool_calls.is_empty();
        message["content"] = if content.is_empty() && saw_tool {
            Value::Null
        } else {
            json!(content)
        };
        if !reasoning.is_empty() {
            message["reasoning_content"] = json!(reasoning);
        }
        if saw_tool {
            message["tool_calls"] = json!(tool_calls);
        }
        let finish_reason = map_anthropic_finish(
            upstream.get("stop_reason").and_then(|r| r.as_str()).unwrap_or("end_turn"),
            saw_tool,
        );
        let usage = upstream.get("usage");
        let input_tokens = usage.and_then(|u| u.get("input_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
        let output_tokens = usage.and_then(|u| u.get("output_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);

        json!({
            "id": upstream.get("id").cloned().unwrap_or_else(|| json!("chatcmpl-proxy")),
            "object": "chat.completion",
            "created": 0,
            "model": upstream.get("model").cloned().unwrap_or(Value::Null),
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }],
            "usage": anthropic_usage(input_tokens, output_tokens),
        })
    }

    fn convert_stream_event(&self, event: &SseEvent, state: &mut StreamState) -> Vec<String> {
        if event.data == "[DONE]" || state.finished {
            return Vec::new();
        }
        let data: Value = match serde_json::from_str(&event.data) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };
        let kind = if event.event.is_empty() {
            data.get("type").and_then(|t| t.as_str()).unwrap_or("")
        } else {
            event.event.as_str()
        };

        let mut out: Vec<String> = Vec::new();
        match kind {
            "message_start" => {
                if let Some(msg) = data.get("message") {
                    if let Some(id) = msg.get("id").and_then(|v| v.as_str()) {
                        state.id = id.to_string();
                    }
                    if let Some(model) = msg.get("model").and_then(|v| v.as_str()) {
                        state.model = model.to_string();
                    }
                    if let Some(t) = msg.get("usage").and_then(|u| u.get("input_tokens")).and_then(|v| v.as_i64()) {
                        state.input_tokens = t;
                    }
                }
            }
            "content_block_start" => {
                let block = data.get("content_block");
                let block_type = block.and_then(|b| b.get("type")).and_then(|t| t.as_str());
                push_role_chunk(state, &mut out);
                if block_type == Some("tool_use") {
                    let block_index = data.get("index").and_then(|v| v.as_i64()).unwrap_or(0).to_string();
                    let idx = state.next_tool_index;
                    state.next_tool_index += 1;
                    state.tool_index.insert(block_index, idx);
                    state.saw_tool_call = true;
                    out.push(chunk_str(
                        state,
                        json!({"tool_calls": [{
                            "index": idx,
                            "id": block.and_then(|b| b.get("id")).cloned().unwrap_or(Value::Null),
                            "type": "function",
                            "function": {
                                "name": block.and_then(|b| b.get("name")).cloned().unwrap_or(Value::Null),
                                "arguments": "",
                            }
                        }]}),
                        None,
                    ));
                }
            }
            "content_block_delta" => {
                let delta = data.get("delta");
                match delta.and_then(|d| d.get("type")).and_then(|t| t.as_str()) {
                    Some("text_delta") => {
                        if let Some(text) = delta.and_then(|d| d.get("text")).and_then(|t| t.as_str()) {
                            push_role_chunk(state, &mut out);
                            out.push(chunk_str(state, json!({"content": text}), None));
                        }
                    }
                    Some("thinking_delta") => {
                        if let Some(text) = delta.and_then(|d| d.get("thinking")).and_then(|t| t.as_str()) {
                            push_role_chunk(state, &mut out);
                            out.push(chunk_str(state, json!({"reasoning_content": text}), None));
                        }
                    }
                    Some("input_json_delta") => {
                        let block_index = data.get("index").and_then(|v| v.as_i64()).unwrap_or(0).to_string();
                        let idx = *state.tool_index.get(&block_index).unwrap_or(&0);
                        if let Some(partial) = delta.and_then(|d| d.get("partial_json")).and_then(|t| t.as_str()) {
                            out.push(chunk_str(
                                state,
                                json!({"tool_calls": [{"index": idx, "function": {"arguments": partial}}]}),
                                None,
                            ));
                        }
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                // Carries the terminal stop_reason + cumulative output tokens.
                let reason = data
                    .get("delta")
                    .and_then(|d| d.get("stop_reason"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("end_turn");
                let finish = map_anthropic_finish(reason, state.saw_tool_call);
                let output_tokens = data
                    .get("usage")
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let usage = anthropic_usage(state.input_tokens, output_tokens);
                out.push(chunk_str_with_usage(state, json!({}), Some(finish), Some(&usage)));
                out.push("[DONE]".to_string());
                state.finished = true;
            }
            _ => {}
        }
        out
    }
}

fn push_role_chunk(state: &mut StreamState, out: &mut Vec<String>) {
    if !state.role_sent {
        state.role_sent = true;
        out.push(chunk_str(state, json!({"role": "assistant"}), None));
    }
}

fn chunk_str(state: &StreamState, delta: Value, finish: Option<&str>) -> String {
    json!({
        "id": non_empty(&state.id, "chatcmpl-proxy"),
        "object": "chat.completion.chunk",
        "created": state.created,
        "model": state.model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    })
    .to_string()
}

/// Build a finish chunk. `usage` is already chat-shaped (`prompt_tokens` etc.).
fn chunk_str_with_usage(
    state: &StreamState,
    delta: Value,
    finish: Option<&str>,
    usage: Option<&Value>,
) -> String {
    let mut chunk = json!({
        "id": non_empty(&state.id, "chatcmpl-proxy"),
        "object": "chat.completion.chunk",
        "created": state.created,
        "model": state.model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    });
    if let Some(u) = usage {
        chunk["usage"] = u.clone();
    }
    chunk.to_string()
}

fn non_empty(s: &str, fallback: &str) -> String {
    if s.is_empty() {
        fallback.to_string()
    } else {
        s.to_string()
    }
}

/// Map Responses `usage` (`input_tokens`/`output_tokens`) to chat/completions
/// (`prompt_tokens`/`completion_tokens`).
fn convert_usage(usage: Option<&Value>) -> Value {
    let Some(u) = usage else {
        return Value::Null;
    };
    let prompt = u.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    let completion = u.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    let total = u
        .get("total_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(prompt + completion);
    json!({
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_single_event_in_one_chunk() {
        let mut acc = SseAccumulator::new();
        let events = acc.push("data: {\"a\":1}\n\n");
        assert_eq!(
            events,
            vec![SseEvent {
                event: String::new(),
                data: "{\"a\":1}".to_string()
            }]
        );
    }

    #[test]
    fn buffers_an_event_split_across_chunks() {
        let mut acc = SseAccumulator::new();
        assert!(acc.push("data: {\"a\":").is_empty());
        assert!(acc.push("1}").is_empty());
        let events = acc.push("\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn yields_multiple_events_from_one_chunk() {
        let mut acc = SseAccumulator::new();
        let events = acc.push("data: 1\n\ndata: 2\n\n");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "1");
        assert_eq!(events[1].data, "2");
    }

    #[test]
    fn joins_multiline_data_and_reads_event_field() {
        let mut acc = SseAccumulator::new();
        let events = acc.push("event: response.delta\ndata: line1\ndata: line2\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "response.delta");
        assert_eq!(events[0].data, "line1\nline2");
    }

    #[test]
    fn normalizes_crlf_boundaries() {
        let mut acc = SseAccumulator::new();
        let events = acc.push("data: x\r\n\r\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "x");
    }

    #[test]
    fn ignores_comment_lines_and_preserves_done_sentinel() {
        let mut acc = SseAccumulator::new();
        let events = acc.push(": keep-alive\n\ndata: [DONE]\n\n");
        // The comment-only block yields no event; [DONE] is preserved verbatim.
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "[DONE]");
    }

    #[test]
    fn finish_flushes_a_trailing_event_without_blank_line() {
        let mut acc = SseAccumulator::new();
        assert!(acc.push("data: tail").is_empty());
        let last = acc.finish();
        assert_eq!(last.map(|e| e.data), Some("tail".to_string()));
    }

    #[test]
    fn finish_is_empty_when_buffer_has_no_fields() {
        let mut acc = SseAccumulator::new();
        acc.push("data: done\n\n");
        assert_eq!(acc.finish(), None);
    }
}

#[cfg(test)]
mod openai_responses_tests {
    use super::*;

    fn conv() -> OpenAIResponsesConverter {
        OpenAIResponsesConverter::new()
    }

    #[test]
    fn request_splits_system_into_instructions_and_maps_input() {
        let body = json!({
            "model": "gpt-5",
            "messages": [
                {"role": "system", "content": "be brief"},
                {"role": "user", "content": "hi"}
            ],
            "max_tokens": 128,
            "temperature": 0.4,
            "stream": true,
            "reasoning_effort": "high"
        });
        let out = conv().convert_request(&body);
        assert_eq!(out["model"], json!("gpt-5"));
        assert_eq!(out["instructions"], json!("be brief"));
        assert_eq!(out["input"], json!([{"role": "user", "content": "hi"}]));
        assert_eq!(out["max_output_tokens"], json!(128));
        assert_eq!(out["temperature"], json!(0.4));
        assert_eq!(out["stream"], json!(true));
        assert_eq!(out["reasoning"], json!({"effort": "high", "summary": "auto"}));
    }

    #[test]
    fn request_flattens_tools_and_maps_tool_messages() {
        let body = json!({
            "model": "gpt-5",
            "messages": [
                {"role": "user", "content": "weather?"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {"name": "getw", "arguments": "{}"}}
                ]},
                {"role": "tool", "tool_call_id": "call_1", "content": "sunny"}
            ],
            "tools": [
                {"type": "function", "function": {"name": "getw", "description": "d", "parameters": {"type": "object"}}}
            ]
        });
        let out = conv().convert_request(&body);
        assert_eq!(
            out["tools"],
            json!([{"type": "function", "name": "getw", "description": "d", "parameters": {"type": "object"}}])
        );
        let input = out["input"].as_array().unwrap();
        assert_eq!(input[0], json!({"role": "user", "content": "weather?"}));
        assert_eq!(
            input[1],
            json!({"type": "function_call", "call_id": "call_1", "name": "getw", "arguments": "{}"})
        );
        assert_eq!(
            input[2],
            json!({"type": "function_call_output", "call_id": "call_1", "output": "sunny"})
        );
    }

    #[test]
    fn response_maps_text_reasoning_and_usage() {
        let upstream = json!({
            "id": "resp_1",
            "model": "gpt-5",
            "created_at": 123,
            "output": [
                {"type": "reasoning", "summary": [{"type": "summary_text", "text": "thinking"}]},
                {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "hello"}]}
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        });
        let out = conv().convert_response(&upstream);
        assert_eq!(out["object"], json!("chat.completion"));
        assert_eq!(out["id"], json!("resp_1"));
        assert_eq!(out["created"], json!(123));
        let choice = &out["choices"][0];
        assert_eq!(choice["message"]["content"], json!("hello"));
        assert_eq!(choice["message"]["reasoning_content"], json!("thinking"));
        assert_eq!(choice["finish_reason"], json!("stop"));
        assert_eq!(out["usage"], json!({"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}));
    }

    #[test]
    fn response_maps_function_call_to_tool_calls() {
        let upstream = json!({
            "id": "resp_2",
            "model": "gpt-5",
            "output": [
                {"type": "function_call", "call_id": "c1", "name": "getw", "arguments": "{\"x\":1}"}
            ]
        });
        let out = conv().convert_response(&upstream);
        let choice = &out["choices"][0];
        assert_eq!(choice["finish_reason"], json!("tool_calls"));
        assert_eq!(choice["message"]["content"], Value::Null);
        assert_eq!(
            choice["message"]["tool_calls"],
            json!([{"id": "c1", "type": "function", "function": {"name": "getw", "arguments": "{\"x\":1}"}}])
        );
    }

    fn ev(event: &str, data: Value) -> SseEvent {
        SseEvent {
            event: event.to_string(),
            data: data.to_string(),
        }
    }

    #[test]
    fn stream_text_deltas_emit_role_then_content() {
        let c = conv();
        let mut state = StreamState::default();
        assert!(c
            .convert_stream_event(
                &ev("response.created", json!({"response": {"id": "r1", "model": "gpt-5", "created_at": 9}})),
                &mut state
            )
            .is_empty());
        let first = c.convert_stream_event(&ev("response.output_text.delta", json!({"delta": "he"})), &mut state);
        assert_eq!(first.len(), 2);
        let role: Value = serde_json::from_str(&first[0]).unwrap();
        assert_eq!(role["choices"][0]["delta"]["role"], json!("assistant"));
        assert_eq!(role["id"], json!("r1"));
        assert_eq!(role["model"], json!("gpt-5"));
        let content: Value = serde_json::from_str(&first[1]).unwrap();
        assert_eq!(content["choices"][0]["delta"]["content"], json!("he"));

        let second = c.convert_stream_event(&ev("response.output_text.delta", json!({"delta": "llo"})), &mut state);
        assert_eq!(second.len(), 1);
        let content2: Value = serde_json::from_str(&second[0]).unwrap();
        assert_eq!(content2["choices"][0]["delta"]["content"], json!("llo"));
    }

    #[test]
    fn stream_reasoning_delta_maps_to_reasoning_content() {
        let c = conv();
        let mut state = StreamState::default();
        let out = c.convert_stream_event(
            &ev("response.reasoning_summary_text.delta", json!({"delta": "hmm"})),
            &mut state,
        );
        // role chunk + reasoning chunk
        assert_eq!(out.len(), 2);
        let reasoning: Value = serde_json::from_str(&out[1]).unwrap();
        assert_eq!(reasoning["choices"][0]["delta"]["reasoning_content"], json!("hmm"));
    }

    #[test]
    fn stream_function_call_emits_header_and_argument_deltas() {
        let c = conv();
        let mut state = StreamState::default();
        let added = c.convert_stream_event(
            &ev(
                "response.output_item.added",
                json!({"item": {"id": "fc_1", "type": "function_call", "call_id": "c1", "name": "getw"}}),
            ),
            &mut state,
        );
        // role chunk + tool header
        assert_eq!(added.len(), 2);
        let header: Value = serde_json::from_str(&added[1]).unwrap();
        let tc = &header["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(tc["index"], json!(0));
        assert_eq!(tc["id"], json!("c1"));
        assert_eq!(tc["function"]["name"], json!("getw"));

        let arg = c.convert_stream_event(
            &ev("response.function_call_arguments.delta", json!({"item_id": "fc_1", "delta": "{\"x\""})),
            &mut state,
        );
        assert_eq!(arg.len(), 1);
        let arg_chunk: Value = serde_json::from_str(&arg[0]).unwrap();
        let atc = &arg_chunk["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(atc["index"], json!(0));
        assert_eq!(atc["function"]["arguments"], json!("{\"x\""));
    }

    #[test]
    fn stream_completed_emits_finish_usage_and_done() {
        let c = conv();
        let mut state = StreamState {
            saw_tool_call: true,
            ..Default::default()
        };
        let out = c.convert_stream_event(
            &ev(
                "response.completed",
                json!({"response": {"usage": {"input_tokens": 3, "output_tokens": 4, "total_tokens": 7}}}),
            ),
            &mut state,
        );
        assert_eq!(out.len(), 2);
        let finish: Value = serde_json::from_str(&out[0]).unwrap();
        assert_eq!(finish["choices"][0]["finish_reason"], json!("tool_calls"));
        assert_eq!(finish["usage"]["prompt_tokens"], json!(3));
        assert_eq!(out[1], "[DONE]");
        assert!(state.finished);
        // Events after completion are ignored.
        assert!(c
            .convert_stream_event(&ev("response.output_text.delta", json!({"delta": "x"})), &mut state)
            .is_empty());
    }

    #[test]
    fn stream_dispatches_on_data_type_when_event_field_absent() {
        let c = conv();
        let mut state = StreamState::default();
        let out = c.convert_stream_event(
            &ev("", json!({"type": "response.output_text.delta", "delta": "hi"})),
            &mut state,
        );
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn stream_ignores_done_sentinel_and_bad_json() {
        let c = conv();
        let mut state = StreamState::default();
        assert!(c
            .convert_stream_event(&SseEvent { event: String::new(), data: "[DONE]".into() }, &mut state)
            .is_empty());
        assert!(c
            .convert_stream_event(&SseEvent { event: String::new(), data: "not json".into() }, &mut state)
            .is_empty());
    }
}

#[cfg(test)]
mod google_generate_content_tests {
    use super::*;

    fn conv() -> GoogleGenerateContentConverter {
        GoogleGenerateContentConverter::new()
    }

    #[test]
    fn path_encodes_model_and_action() {
        let c = conv();
        assert_eq!(
            c.upstream_path(&json!({"model": "gemini-2.5-pro"})),
            "/models/gemini-2.5-pro:generateContent"
        );
        assert_eq!(
            c.upstream_path(&json!({"model": "gemini-2.5-pro", "stream": true})),
            "/models/gemini-2.5-pro:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn auth_uses_goog_api_key() {
        assert_eq!(conv().auth_header("k"), ("x-goog-api-key", "k".to_string()));
    }

    #[test]
    fn request_maps_roles_system_and_thinking() {
        let body = json!({
            "model": "gemini-2.5-pro",
            "messages": [
                {"role": "system", "content": "be brief"},
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"}
            ],
            "temperature": 0.5,
            "top_p": 0.9,
            "max_tokens": 100,
            "reasoning_effort": "high"
        });
        let out = conv().convert_request(&body);
        assert_eq!(out["systemInstruction"], json!({"parts": [{"text": "be brief"}]}));
        assert_eq!(
            out["contents"],
            json!([
                {"role": "user", "parts": [{"text": "hi"}]},
                {"role": "model", "parts": [{"text": "hello"}]}
            ])
        );
        assert_eq!(out["generationConfig"]["temperature"], json!(0.5));
        assert_eq!(out["generationConfig"]["topP"], json!(0.9));
        assert_eq!(out["generationConfig"]["maxOutputTokens"], json!(100));
        assert_eq!(
            out["generationConfig"]["thinkingConfig"],
            json!({"thinkingBudget": -1, "includeThoughts": true})
        );
    }

    #[test]
    fn request_maps_tool_calls_and_results() {
        let body = json!({
            "model": "gemini-2.5-pro",
            "messages": [
                {"role": "user", "content": "weather?"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {"name": "getw", "arguments": "{\"city\":\"NYC\"}"}}
                ]},
                {"role": "tool", "tool_call_id": "call_1", "content": "{\"temp\":20}"}
            ],
            "tools": [
                {"type": "function", "function": {"name": "getw", "description": "d", "parameters": {"type": "object"}}}
            ],
            "tool_choice": "required"
        });
        let out = conv().convert_request(&body);
        let contents = out["contents"].as_array().unwrap();
        assert_eq!(
            contents[1],
            json!({"role": "model", "parts": [{"functionCall": {"name": "getw", "args": {"city": "NYC"}}}]})
        );
        assert_eq!(
            contents[2],
            json!({"role": "user", "parts": [{"functionResponse": {"name": "getw", "response": {"temp": 20}}}]})
        );
        assert_eq!(
            out["tools"],
            json!([{"functionDeclarations": [{"name": "getw", "description": "d", "parameters": {"type": "object"}}]}])
        );
        assert_eq!(out["toolConfig"], json!({"functionCallingConfig": {"mode": "ANY"}}));
    }

    #[test]
    fn tool_result_wraps_non_json_content() {
        let body = json!({
            "model": "g",
            "messages": [{"role": "tool", "tool_call_id": "x", "content": "plain text"}]
        });
        let out = conv().convert_request(&body);
        assert_eq!(
            out["contents"][0]["parts"][0]["functionResponse"]["response"],
            json!({"result": "plain text"})
        );
    }

    #[test]
    fn response_maps_text_thought_and_usage() {
        let upstream = json!({
            "responseId": "r1",
            "modelVersion": "gemini-2.5-pro",
            "candidates": [{
                "content": {"role": "model", "parts": [
                    {"text": "thinking...", "thought": true},
                    {"text": "answer"}
                ]},
                "finishReason": "STOP"
            }],
            "usageMetadata": {"promptTokenCount": 8, "candidatesTokenCount": 4, "thoughtsTokenCount": 2, "totalTokenCount": 14}
        });
        let out = conv().convert_response(&upstream);
        let choice = &out["choices"][0];
        assert_eq!(choice["message"]["content"], json!("answer"));
        assert_eq!(choice["message"]["reasoning_content"], json!("thinking..."));
        assert_eq!(choice["finish_reason"], json!("stop"));
        assert_eq!(out["id"], json!("r1"));
        assert_eq!(out["model"], json!("gemini-2.5-pro"));
        assert_eq!(out["usage"], json!({"prompt_tokens": 8, "completion_tokens": 6, "total_tokens": 14}));
    }

    #[test]
    fn response_maps_function_call() {
        let upstream = json!({
            "candidates": [{
                "content": {"parts": [{"functionCall": {"name": "getw", "args": {"city": "NYC"}}}]},
                "finishReason": "STOP"
            }]
        });
        let out = conv().convert_response(&upstream);
        let choice = &out["choices"][0];
        assert_eq!(choice["finish_reason"], json!("tool_calls"));
        assert_eq!(choice["message"]["content"], Value::Null);
        let tc = &choice["message"]["tool_calls"][0];
        assert_eq!(tc["id"], json!("call_0"));
        assert_eq!(tc["function"]["name"], json!("getw"));
        assert_eq!(tc["function"]["arguments"], json!("{\"city\":\"NYC\"}"));
    }

    fn ev(data: Value) -> SseEvent {
        SseEvent { event: String::new(), data: data.to_string() }
    }

    #[test]
    fn stream_emits_role_reasoning_content_and_finish() {
        let c = conv();
        let mut state = StreamState::default();
        let first = c.convert_stream_event(
            &ev(json!({
                "modelVersion": "gemini-2.5-pro",
                "candidates": [{"content": {"parts": [{"text": "hmm", "thought": true}]}}]
            })),
            &mut state,
        );
        assert_eq!(first.len(), 2);
        let role: Value = serde_json::from_str(&first[0]).unwrap();
        assert_eq!(role["choices"][0]["delta"]["role"], json!("assistant"));
        assert_eq!(role["model"], json!("gemini-2.5-pro"));
        let reason: Value = serde_json::from_str(&first[1]).unwrap();
        assert_eq!(reason["choices"][0]["delta"]["reasoning_content"], json!("hmm"));

        let second = c.convert_stream_event(
            &ev(json!({"candidates": [{"content": {"parts": [{"text": "hello"}]}}]})),
            &mut state,
        );
        assert_eq!(second.len(), 1);
        let content: Value = serde_json::from_str(&second[0]).unwrap();
        assert_eq!(content["choices"][0]["delta"]["content"], json!("hello"));

        let last = c.convert_stream_event(
            &ev(json!({
                "candidates": [{"finishReason": "STOP"}],
                "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2, "totalTokenCount": 5}
            })),
            &mut state,
        );
        assert_eq!(last.len(), 2);
        let finish: Value = serde_json::from_str(&last[0]).unwrap();
        assert_eq!(finish["choices"][0]["finish_reason"], json!("stop"));
        assert_eq!(finish["usage"]["prompt_tokens"], json!(3));
        assert_eq!(last[1], "[DONE]");
        assert!(state.finished);
    }

    #[test]
    fn stream_function_call_emits_full_tool_call() {
        let c = conv();
        let mut state = StreamState::default();
        let out = c.convert_stream_event(
            &ev(json!({
                "candidates": [{
                    "content": {"parts": [{"functionCall": {"name": "getw", "args": {"x": 1}}}]},
                    "finishReason": "STOP"
                }]
            })),
            &mut state,
        );
        // role chunk + tool_calls chunk + finish + [DONE]
        assert_eq!(out.len(), 4);
        let tool: Value = serde_json::from_str(&out[1]).unwrap();
        let tc = &tool["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(tc["index"], json!(0));
        assert_eq!(tc["id"], json!("call_0"));
        assert_eq!(tc["function"]["name"], json!("getw"));
        assert_eq!(tc["function"]["arguments"], json!("{\"x\":1}"));
        let finish: Value = serde_json::from_str(&out[2]).unwrap();
        assert_eq!(finish["choices"][0]["finish_reason"], json!("tool_calls"));
        assert_eq!(out[3], "[DONE]");
    }
}

#[cfg(test)]
mod anthropic_messages_tests {
    use super::*;

    fn conv() -> AnthropicMessagesConverter {
        AnthropicMessagesConverter::new()
    }

    #[test]
    fn auth_and_headers() {
        let c = conv();
        assert_eq!(c.auth_header("k"), ("x-api-key", "k".to_string()));
        assert_eq!(c.extra_headers(), vec![("anthropic-version", "2023-06-01")]);
        assert_eq!(c.upstream_path(&json!({})), "/messages");
    }

    #[test]
    fn request_maps_system_messages_and_default_max_tokens() {
        let body = json!({
            "model": "claude-sonnet-4",
            "messages": [
                {"role": "system", "content": "be brief"},
                {"role": "user", "content": "hi"}
            ]
        });
        let out = conv().convert_request(&body);
        assert_eq!(out["model"], json!("claude-sonnet-4"));
        assert_eq!(out["system"], json!("be brief"));
        assert_eq!(out["max_tokens"], json!(ANTHROPIC_DEFAULT_MAX_TOKENS));
        assert_eq!(
            out["messages"],
            json!([{"role": "user", "content": [{"type": "text", "text": "hi"}]}])
        );
    }

    #[test]
    fn request_merges_consecutive_tool_results_into_one_user_message() {
        let body = json!({
            "model": "claude-sonnet-4",
            "max_tokens": 256,
            "messages": [
                {"role": "user", "content": "go"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "a", "type": "function", "function": {"name": "f1", "arguments": "{\"x\":1}"}},
                    {"id": "b", "type": "function", "function": {"name": "f2", "arguments": "{}"}}
                ]},
                {"role": "tool", "tool_call_id": "a", "content": "r1"},
                {"role": "tool", "tool_call_id": "b", "content": "r2"}
            ]
        });
        let out = conv().convert_request(&body);
        assert_eq!(out["max_tokens"], json!(256));
        let msgs = out["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[1]["role"], json!("assistant"));
        assert_eq!(
            msgs[1]["content"],
            json!([
                {"type": "tool_use", "id": "a", "name": "f1", "input": {"x": 1}},
                {"type": "tool_use", "id": "b", "name": "f2", "input": {}}
            ])
        );
        // Both tool results merged into a single user message.
        assert_eq!(msgs[2]["role"], json!("user"));
        assert_eq!(
            msgs[2]["content"],
            json!([
                {"type": "tool_result", "tool_use_id": "a", "content": "r1"},
                {"type": "tool_result", "tool_use_id": "b", "content": "r2"}
            ])
        );
    }

    #[test]
    fn request_maps_tools_and_tool_choice() {
        let body = json!({
            "model": "c",
            "messages": [],
            "tools": [{"type": "function", "function": {"name": "f", "description": "d", "parameters": {"type": "object"}}}],
            "tool_choice": "required"
        });
        let out = conv().convert_request(&body);
        assert_eq!(
            out["tools"],
            json!([{"name": "f", "description": "d", "input_schema": {"type": "object"}}])
        );
        assert_eq!(out["tool_choice"], json!({"type": "any"}));
    }

    #[test]
    fn request_maps_named_tool_choice() {
        let body = json!({
            "model": "c",
            "messages": [],
            "tool_choice": {"type": "function", "function": {"name": "pick"}}
        });
        let out = conv().convert_request(&body);
        assert_eq!(out["tool_choice"], json!({"type": "tool", "name": "pick"}));
    }

    #[test]
    fn response_maps_text_thinking_tool_use_and_usage() {
        let upstream = json!({
            "id": "msg_1",
            "model": "claude-sonnet-4",
            "content": [
                {"type": "thinking", "thinking": "hmm"},
                {"type": "text", "text": "hello"},
                {"type": "tool_use", "id": "tu_1", "name": "f", "input": {"a": 1}}
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 12, "output_tokens": 6}
        });
        let out = conv().convert_response(&upstream);
        let choice = &out["choices"][0];
        assert_eq!(choice["message"]["content"], json!("hello"));
        assert_eq!(choice["message"]["reasoning_content"], json!("hmm"));
        assert_eq!(choice["finish_reason"], json!("tool_calls"));
        let tc = &choice["message"]["tool_calls"][0];
        assert_eq!(tc["id"], json!("tu_1"));
        assert_eq!(tc["function"]["arguments"], json!("{\"a\":1}"));
        assert_eq!(out["usage"], json!({"prompt_tokens": 12, "completion_tokens": 6, "total_tokens": 18}));
    }

    fn ev(event: &str, data: Value) -> SseEvent {
        SseEvent { event: event.to_string(), data: data.to_string() }
    }

    #[test]
    fn stream_full_sequence() {
        let c = conv();
        let mut state = StreamState::default();
        c.convert_stream_event(
            &ev("message_start", json!({"message": {"id": "msg_1", "model": "claude-sonnet-4", "usage": {"input_tokens": 10}}})),
            &mut state,
        );
        let block = c.convert_stream_event(
            &ev("content_block_start", json!({"index": 0, "content_block": {"type": "text"}})),
            &mut state,
        );
        // role chunk on first content block
        assert_eq!(block.len(), 1);
        let role: Value = serde_json::from_str(&block[0]).unwrap();
        assert_eq!(role["choices"][0]["delta"]["role"], json!("assistant"));
        assert_eq!(role["id"], json!("msg_1"));

        let text = c.convert_stream_event(
            &ev("content_block_delta", json!({"index": 0, "delta": {"type": "text_delta", "text": "hi"}})),
            &mut state,
        );
        assert_eq!(text.len(), 1);
        let content: Value = serde_json::from_str(&text[0]).unwrap();
        assert_eq!(content["choices"][0]["delta"]["content"], json!("hi"));

        let reasoning = c.convert_stream_event(
            &ev("content_block_delta", json!({"index": 0, "delta": {"type": "thinking_delta", "thinking": "why"}})),
            &mut state,
        );
        let r: Value = serde_json::from_str(&reasoning[0]).unwrap();
        assert_eq!(r["choices"][0]["delta"]["reasoning_content"], json!("why"));

        let done = c.convert_stream_event(
            &ev("message_delta", json!({"delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 5}})),
            &mut state,
        );
        assert_eq!(done.len(), 2);
        let finish: Value = serde_json::from_str(&done[0]).unwrap();
        assert_eq!(finish["choices"][0]["finish_reason"], json!("stop"));
        assert_eq!(finish["usage"], json!({"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}));
        assert_eq!(done[1], "[DONE]");
        assert!(state.finished);
    }

    #[test]
    fn stream_tool_use_emits_header_and_argument_deltas() {
        let c = conv();
        let mut state = StreamState::default();
        let start = c.convert_stream_event(
            &ev("content_block_start", json!({"index": 1, "content_block": {"type": "tool_use", "id": "tu_1", "name": "f"}})),
            &mut state,
        );
        // role chunk + tool header
        assert_eq!(start.len(), 2);
        let header: Value = serde_json::from_str(&start[1]).unwrap();
        let tc = &header["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(tc["index"], json!(0));
        assert_eq!(tc["id"], json!("tu_1"));
        assert_eq!(tc["function"]["name"], json!("f"));

        let arg = c.convert_stream_event(
            &ev("content_block_delta", json!({"index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"a\""}})),
            &mut state,
        );
        let arg_chunk: Value = serde_json::from_str(&arg[0]).unwrap();
        let atc = &arg_chunk["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(atc["index"], json!(0));
        assert_eq!(atc["function"]["arguments"], json!("{\"a\""));
    }
}
