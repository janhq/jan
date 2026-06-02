//! Translation shim between OpenAI's Responses API (`/v1/responses`) and the
//! Chat Completions API (`/v1/chat/completions`).
//!
//! Codex CLI speaks only the Responses wire protocol — `wire_api = "responses"`
//! is its sole supported value as of v0.135 — but our llama.cpp backends
//! implement only Chat Completions. This module converts a Responses request
//! into a Chat Completions request and converts the Chat Completions reply
//! (both the single-shot JSON form and the streamed SSE form) back into
//! Responses objects/events, so Codex — and any other Responses-only client —
//! works against a local GGUF model.
//!
//! MLX sessions and remote providers serve `/v1/responses` natively, so the
//! proxy forwards those untouched (see the passthrough branch in `proxy.rs`);
//! only the turboquant / upstream llama.cpp backends go through this shim.

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use uuid::Uuid;

pub fn new_response_id() -> String {
    format!("resp_{}", Uuid::new_v4().simple())
}

fn new_message_id() -> String {
    format!("msg_{}", Uuid::new_v4().simple())
}

fn new_fc_id() -> String {
    format!("fc_{}", Uuid::new_v4().simple())
}

/// Convert a Responses API request body into a Chat Completions request body.
pub fn responses_request_to_chat(body: &Value) -> Value {
    let mut messages: Vec<Value> = Vec::new();

    // `instructions` (the system prompt in the Responses API) becomes a leading
    // system message.
    if let Some(instr) = body.get("instructions").and_then(|v| v.as_str()) {
        if !instr.is_empty() {
            messages.push(json!({"role": "system", "content": instr}));
        }
    }

    match body.get("input") {
        Some(Value::String(s)) => {
            messages.push(json!({"role": "user", "content": s}));
        }
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(msg) = responses_input_item_to_chat(item) {
                    messages.push(msg);
                }
            }
        }
        _ => {}
    }

    let mut out = json!({ "messages": messages });
    let obj = out.as_object_mut().unwrap();

    if let Some(model) = body.get("model") {
        obj.insert("model".into(), model.clone());
    }
    if let Some(stream) = body.get("stream") {
        obj.insert("stream".into(), stream.clone());
        // Ask the backend to include a usage block in the final streamed chunk
        // so we can populate Responses `usage` on `response.completed`.
        if stream.as_bool() == Some(true) {
            obj.insert("stream_options".into(), json!({"include_usage": true}));
        }
    }
    if let Some(v) = body.get("temperature") {
        obj.insert("temperature".into(), v.clone());
    }
    if let Some(v) = body.get("top_p") {
        obj.insert("top_p".into(), v.clone());
    }
    // Responses caps output with `max_output_tokens`; Chat uses `max_tokens`.
    if let Some(v) = body.get("max_output_tokens") {
        obj.insert("max_tokens".into(), v.clone());
    }
    if let Some(v) = body.get("parallel_tool_calls") {
        obj.insert("parallel_tool_calls".into(), v.clone());
    }

    if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
        let chat_tools: Vec<Value> = tools.iter().filter_map(responses_tool_to_chat).collect();
        if !chat_tools.is_empty() {
            obj.insert("tools".into(), Value::Array(chat_tools));
        }
    }
    if let Some(tc) = body.get("tool_choice") {
        obj.insert("tool_choice".into(), responses_tool_choice_to_chat(tc));
    }

    // Structured output: Responses `text.format` -> Chat `response_format`.
    if let Some(format) = body.get("text").and_then(|t| t.get("format")) {
        if let Some(rf) = responses_text_format_to_chat(format) {
            obj.insert("response_format".into(), rf);
        }
    }

    out
}

fn responses_input_item_to_chat(item: &Value) -> Option<Value> {
    let ty = item
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("message");
    match ty {
        "message" => {
            let role = item.get("role").and_then(|v| v.as_str()).unwrap_or("user");
            let text = flatten_content_to_text(item.get("content"));
            Some(json!({"role": role, "content": text}))
        }
        "function_call" => {
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = item
                .get("arguments")
                .and_then(|v| v.as_str())
                .unwrap_or("{}");
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(json!({
                "role": "assistant",
                "content": Value::Null,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": args}
                }]
            }))
        }
        "function_call_output" => {
            let call_id = item.get("call_id").and_then(|v| v.as_str()).unwrap_or("");
            let content = match item.get("output") {
                Some(Value::String(s)) => s.clone(),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            Some(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": content
            }))
        }
        // Reasoning items (and any other Responses-only item) have no Chat
        // Completions equivalent; drop them from the replayed conversation.
        _ => None,
    }
}

/// Flatten Responses content (a string, or an array of typed parts) to plain
/// text. Non-text parts (images/files) are ignored on the text-only Chat path.
fn flatten_content_to_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => {
            let mut buf = String::new();
            for part in parts {
                if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                    buf.push_str(t);
                }
            }
            buf
        }
        _ => String::new(),
    }
}

fn responses_tool_to_chat(tool: &Value) -> Option<Value> {
    // A Responses function tool is flat: {type, name, description, parameters}.
    // Built-in tools (web_search, etc.) have no Chat equivalent and are dropped.
    if tool.get("type").and_then(|v| v.as_str()) != Some("function") {
        return None;
    }
    let name = tool.get("name")?.clone();
    let mut func = Map::new();
    func.insert("name".into(), name);
    if let Some(d) = tool.get("description") {
        func.insert("description".into(), d.clone());
    }
    if let Some(p) = tool.get("parameters") {
        func.insert("parameters".into(), p.clone());
    }
    Some(json!({"type": "function", "function": Value::Object(func)}))
}

fn responses_tool_choice_to_chat(tc: &Value) -> Value {
    match tc {
        // "auto" | "none" | "required" pass through unchanged.
        Value::String(_) => tc.clone(),
        Value::Object(_) => {
            if let Some(name) = tc.get("name").and_then(|v| v.as_str()) {
                json!({"type": "function", "function": {"name": name}})
            } else {
                tc.clone()
            }
        }
        _ => json!("auto"),
    }
}

fn responses_text_format_to_chat(format: &Value) -> Option<Value> {
    match format.get("type").and_then(|v| v.as_str())? {
        "json_schema" => {
            let mut js = Map::new();
            if let Some(n) = format.get("name") {
                js.insert("name".into(), n.clone());
            }
            if let Some(s) = format.get("schema") {
                js.insert("schema".into(), s.clone());
            }
            if let Some(strict) = format.get("strict") {
                js.insert("strict".into(), strict.clone());
            }
            Some(json!({"type": "json_schema", "json_schema": Value::Object(js)}))
        }
        "json_object" => Some(json!({"type": "json_object"})),
        _ => None,
    }
}

/// Map a Chat Completions `usage` block to the Responses `usage` shape.
fn map_usage(u: &Value) -> Value {
    let input = u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let output = u
        .get("completion_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let total = u
        .get("total_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(input + output);
    json!({
        "input_tokens": input,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens": output,
        "output_tokens_details": {"reasoning_tokens": 0},
        "total_tokens": total
    })
}

/// Build the `output` array (assistant message + function_call items) from a
/// Chat Completions assistant message.
fn message_to_output_items(message: Option<&Value>) -> Vec<Value> {
    let mut output: Vec<Value> = Vec::new();
    let Some(msg) = message else {
        return output;
    };

    if let Some(text) = msg.get("content").and_then(|v| v.as_str()) {
        if !text.is_empty() {
            output.push(json!({
                "type": "message",
                "id": new_message_id(),
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}]
            }));
        }
    }

    if let Some(tool_calls) = msg.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tool_calls {
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .cloned()
                .unwrap_or_else(|| json!(""));
            let args = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let call_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
            output.push(json!({
                "type": "function_call",
                "id": new_fc_id(),
                "call_id": call_id,
                "name": name,
                "arguments": args,
                "status": "completed"
            }));
        }
    }

    output
}

/// Convert a non-streaming Chat Completions response into a Responses object.
pub fn chat_response_to_responses(chat: &Value, response_id: &str, model_fallback: &str) -> Value {
    let model = chat
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(model_fallback);
    let created = chat.get("created").and_then(|v| v.as_u64()).unwrap_or(0);

    let message = chat
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"));

    let output = message_to_output_items(message);
    let usage = chat.get("usage").map(map_usage).unwrap_or(Value::Null);

    json!({
        "id": response_id,
        "object": "response",
        "created_at": created,
        "status": "completed",
        "model": model,
        "output": output,
        "usage": usage,
        "parallel_tool_calls": true,
        "tool_choice": "auto",
        "tools": []
    })
}

struct ToolAcc {
    item_id: String,
    output_index: usize,
    call_id: String,
    name: String,
    args: String,
    added: bool,
}

/// Stateful converter from a Chat Completions SSE stream to the Responses SSE
/// event protocol. Feed each parsed Chat `data:` JSON chunk to [`on_chunk`] and
/// emit the returned events; call [`finish`] when the stream ends (`[DONE]`).
///
/// Emits the event sequence Codex consumes: `response.created`, per-item
/// `response.output_item.added` / `response.output_text.delta` /
/// `response.function_call_arguments.delta`, the matching `*.done` events, and
/// a terminal `response.completed` carrying the full `output` and `usage`.
pub struct ResponsesStreamConverter {
    response_id: String,
    model: String,
    seq: u64,
    next_output_index: usize,
    // assistant text message item
    msg_item_id: Option<String>,
    msg_output_index: usize,
    text: String,
    // tool calls keyed by the Chat `tool_calls[].index`
    tools: BTreeMap<u64, ToolAcc>,
}

impl ResponsesStreamConverter {
    pub fn new(response_id: String, model: String) -> Self {
        Self {
            response_id,
            model,
            seq: 0,
            next_output_index: 0,
            msg_item_id: None,
            msg_output_index: 0,
            text: String::new(),
            tools: BTreeMap::new(),
        }
    }

    fn next_seq(&mut self) -> u64 {
        let s = self.seq;
        self.seq += 1;
        s
    }

    fn response_envelope(&self, status: &str, output: Value, usage: Value) -> Value {
        json!({
            "id": self.response_id,
            "object": "response",
            "status": status,
            "model": self.model,
            "output": output,
            "usage": usage,
            "parallel_tool_calls": true,
            "tool_choice": "auto",
            "tools": []
        })
    }

    /// The opening `response.created` event. Send once, before any chunk.
    pub fn created_event(&mut self) -> Value {
        let seq = self.next_seq();
        json!({
            "type": "response.created",
            "sequence_number": seq,
            "response": self.response_envelope("in_progress", json!([]), Value::Null)
        })
    }

    pub fn on_chunk(&mut self, chunk: &Value) -> Vec<Value> {
        let mut events: Vec<Value> = Vec::new();
        let Some(choice) = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
        else {
            return events;
        };
        let Some(delta) = choice.get("delta") else {
            return events;
        };

        // Text content delta.
        if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                if self.msg_item_id.is_none() {
                    let item_id = new_message_id();
                    let output_index = self.next_output_index;
                    self.next_output_index += 1;
                    self.msg_item_id = Some(item_id.clone());
                    self.msg_output_index = output_index;

                    let seq = self.next_seq();
                    events.push(json!({
                        "type": "response.output_item.added",
                        "sequence_number": seq,
                        "output_index": output_index,
                        "item": {
                            "type": "message",
                            "id": item_id,
                            "status": "in_progress",
                            "role": "assistant",
                            "content": []
                        }
                    }));
                    let seq = self.next_seq();
                    events.push(json!({
                        "type": "response.content_part.added",
                        "sequence_number": seq,
                        "item_id": self.msg_item_id.clone(),
                        "output_index": output_index,
                        "content_index": 0,
                        "part": {"type": "output_text", "text": "", "annotations": []}
                    }));
                }
                self.text.push_str(text);
                let seq = self.next_seq();
                events.push(json!({
                    "type": "response.output_text.delta",
                    "sequence_number": seq,
                    "item_id": self.msg_item_id.clone(),
                    "output_index": self.msg_output_index,
                    "content_index": 0,
                    "delta": text
                }));
            }
        }

        // Tool-call deltas.
        if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tool_calls {
                let index = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                let is_new = !self.tools.contains_key(&index);
                if is_new {
                    let output_index = self.next_output_index;
                    self.next_output_index += 1;
                    self.tools.insert(
                        index,
                        ToolAcc {
                            item_id: new_fc_id(),
                            output_index,
                            call_id: String::new(),
                            name: String::new(),
                            args: String::new(),
                            added: false,
                        },
                    );
                }
                let acc = self.tools.get_mut(&index).unwrap();
                if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        acc.call_id = id.to_string();
                    }
                }
                if let Some(name) = tc
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                {
                    if !name.is_empty() {
                        acc.name.push_str(name);
                    }
                }

                if !acc.added {
                    acc.added = true;
                    let item_id = acc.item_id.clone();
                    let output_index = acc.output_index;
                    let call_id = acc.call_id.clone();
                    let name = acc.name.clone();
                    let seq = self.next_seq();
                    events.push(json!({
                        "type": "response.output_item.added",
                        "sequence_number": seq,
                        "output_index": output_index,
                        "item": {
                            "type": "function_call",
                            "id": item_id,
                            "status": "in_progress",
                            "call_id": call_id,
                            "name": name,
                            "arguments": ""
                        }
                    }));
                }

                if let Some(args) = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                {
                    if !args.is_empty() {
                        let acc = self.tools.get_mut(&index).unwrap();
                        acc.args.push_str(args);
                        let item_id = acc.item_id.clone();
                        let output_index = acc.output_index;
                        let seq = self.next_seq();
                        events.push(json!({
                            "type": "response.function_call_arguments.delta",
                            "sequence_number": seq,
                            "item_id": item_id,
                            "output_index": output_index,
                            "delta": args
                        }));
                    }
                }
            }
        }

        events
    }

    /// Closing events: per-item `*.done` plus the terminal `response.completed`.
    pub fn finish(&mut self, usage: Option<&Value>) -> Vec<Value> {
        let mut events: Vec<Value> = Vec::new();

        // Ordered output items for the final envelope.
        let mut items: Vec<(usize, Value)> = Vec::new();

        if let Some(item_id) = self.msg_item_id.clone() {
            let output_index = self.msg_output_index;
            let text = self.text.clone();

            let seq = self.next_seq();
            events.push(json!({
                "type": "response.output_text.done",
                "sequence_number": seq,
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "text": text
            }));
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.content_part.done",
                "sequence_number": seq,
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": {"type": "output_text", "text": text, "annotations": []}
            }));
            let item = json!({
                "type": "message",
                "id": item_id,
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}]
            });
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.output_item.done",
                "sequence_number": seq,
                "output_index": output_index,
                "item": item.clone()
            }));
            items.push((output_index, item));
        }

        let tools = std::mem::take(&mut self.tools);
        for acc in tools.values() {
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.function_call_arguments.done",
                "sequence_number": seq,
                "item_id": acc.item_id,
                "output_index": acc.output_index,
                "arguments": acc.args
            }));
            let item = json!({
                "type": "function_call",
                "id": acc.item_id,
                "status": "completed",
                "call_id": acc.call_id,
                "name": acc.name,
                "arguments": acc.args
            });
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.output_item.done",
                "sequence_number": seq,
                "output_index": acc.output_index,
                "item": item.clone()
            }));
            items.push((acc.output_index, item));
        }

        items.sort_by_key(|(idx, _)| *idx);
        let output: Vec<Value> = items.into_iter().map(|(_, v)| v).collect();
        let usage = usage.map(map_usage).unwrap_or(Value::Null);

        let seq = self.next_seq();
        events.push(json!({
            "type": "response.completed",
            "sequence_number": seq,
            "response": self.response_envelope("completed", Value::Array(output), usage)
        }));

        events
    }
}
