//! The agent's upstream chat client, built on `genai`.
//!
//! Every provider the agent talks to routes through here: cloud providers, a Jan
//! desktop API server, a local llama.cpp router, an MLX session. The wire format
//! stays OpenAI `/chat/completions` -- `genai` is used for its provider handling
//! (field-name variance, SSE correctness, tool-call merging), not to change the
//! protocol.
//!
//! The boundary is deliberately JSON in / JSON out, matching what
//! [`super::upstream`] and `core::agent::loop` already pass around: a request
//! body as `serde_json::Value` and a reconstructed non-streaming completion back.
//! Threads persist messages in that shape, so converting the agent loop to
//! `genai`'s types would change an on-disk format for no gain.
//!
//! The API server proxy (`core::server::proxy`) does NOT come through here: it
//! forwards upstream bytes verbatim to external SDK clients, and re-serializing
//! through typed structs would corrupt that passthrough.

use std::time::Duration;

use genai::adapter::AdapterKind;
use genai::chat::{
    ChatMessage, ChatOptions, ChatRequest, ChatRole, ChatStreamEvent, ContentPart, MessageContent,
    ReasoningEffort, Tool, ToolCall, ToolResponse,
};
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ClientBuilder, ModelIden, ServiceTarget};
use tokio::sync::mpsc;
use tokio_stream::StreamExt;

use crate::core::agent::events::StreamEvent;

/// How long a pooled connection may sit idle. Deliberately shorter than any
/// plausible upstream idle timeout: a turn spends minutes running tools with no
/// bytes flowing, and reusing a connection the peer already reclaimed is the
/// `Connection reset by peer` a long session otherwise hits.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(15);
const TCP_KEEPALIVE: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// The pool-tuned client every agent turn goes through. `genai` is on reqwest
/// 0.13 while the rest of the app is on 0.12, so this is the aliased crate --
/// the two `Client` types are not interchangeable.
///
/// No overall request timeout: a streamed answer legitimately runs for minutes.
pub(crate) fn shared_http_client() -> reqwest13::Client {
    // One pool for the process. `reqwest::Client` is an `Arc` internally, so the
    // clone is cheap and every caller shares the same connections -- building one
    // per turn (or per API-server request) would discard the pool each time,
    // which is the opposite of what the idle-timeout tuning above is for.
    static SHARED: std::sync::LazyLock<reqwest13::Client> =
        std::sync::LazyLock::new(build_http_client);
    SHARED.clone()
}

fn build_http_client() -> reqwest13::Client {
    reqwest13::Client::builder()
        .pool_idle_timeout(POOL_IDLE_TIMEOUT)
        .tcp_keepalive(TCP_KEEPALIVE)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .unwrap_or_default()
}

/// Turn the full chat-completions URL the resolver produces into the endpoint
/// base `genai` expects.
///
/// `genai` appends the service suffix with `Url::join("chat/completions")`, and
/// `join` *replaces* the last path segment unless the base ends in `/`. Without
/// the trailing slash `https://host/v1` would resolve to `https://host/chat/completions`,
/// silently dropping `/v1` -- so the slash is not cosmetic.
pub(crate) fn endpoint_base_from_chat_url(upstream_url: &str) -> String {
    let trimmed = upstream_url.trim_end_matches('/');
    let base = trimmed
        .strip_suffix("/chat/completions")
        .unwrap_or(trimmed);
    format!("{base}/")
}

/// Map a provider's configured `api_type` to a `genai` adapter. Everything
/// unrecognized stays on the OpenAI-compatible path, which is what the agent has
/// always spoken and what every provider in `~/.jan/config.toml` serves today.
pub(crate) fn adapter_kind_for(api_type: Option<&str>) -> AdapterKind {
    match api_type {
        Some("anthropic") => AdapterKind::Anthropic,
        Some("google") => AdapterKind::Gemini,
        Some("openai-responses") => AdapterKind::OpenAIResp,
        _ => AdapterKind::OpenAI,
    }
}

/// Build a client pinned to one endpoint, key, and adapter. The resolver is
/// fixed rather than model-derived: the agent has already resolved which
/// upstream this model lives on, and letting `genai` re-derive it from the model
/// name would route a local llama.cpp model to api.openai.com.
fn client_for(
    http: &reqwest13::Client,
    endpoint_base: &str,
    request_url: &str,
    api_key: Option<&str>,
    adapter: AdapterKind,
) -> Client {
    let endpoint = Endpoint::from_owned(endpoint_base.to_string());

    // `RequestOverride` rather than `AuthData::Key`, for three reasons:
    //
    //  * Keyless local endpoints (llama.cpp, LM Studio) have no key to send.
    //    `AuthData::None` is rejected for `AdapterKind::OpenAI` -- only the MLX
    //    adapter sets `allow_no_api_key` -- and an empty `Bearer` is worse than
    //    no header at all, since some servers reject it outright.
    //  * The override supplies the request URL verbatim, so the resolved
    //    upstream URL is used exactly as the agent computed it instead of being
    //    rebuilt by `Url::join`.
    //  * `Accept-Encoding: identity` has to reach the upstream: a compressed SSE
    //    body defeats incremental delivery, which is the whole point of a stream.
    let mut headers: Vec<(String, String)> = vec![
        ("Content-Type".to_string(), "application/json".to_string()),
        ("Accept".to_string(), "text/event-stream".to_string()),
        ("Accept-Encoding".to_string(), "identity".to_string()),
    ];
    if let Some(key) = api_key.filter(|k| !k.is_empty()) {
        headers.push(("Authorization".to_string(), format!("Bearer {key}")));
    }
    let auth = AuthData::RequestOverride {
        url: request_url.to_string(),
        headers: genai::Headers::from(headers),
    };
    let resolver = ServiceTargetResolver::from_resolver_fn(
        move |target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            let ServiceTarget { model, .. } = target;
            Ok(ServiceTarget {
                endpoint: endpoint.clone(),
                auth: auth.clone(),
                model: ModelIden::new(adapter, model.model_name),
            })
        },
    );

    ClientBuilder::default()
        .with_reqwest(http.clone())
        .with_service_target_resolver(resolver)
        .build()
}

/// Everything the agent sends that `genai`'s typed options do not model. `top_k`
/// and `stop_sequences` are not OpenAI-standard but reach llama.cpp and vLLM,
/// so they ride through `extra_body` verbatim rather than being dropped.
const EXTRA_BODY_KEYS: &[&str] = &["top_k", "frequency_penalty", "presence_penalty"];

/// Split an OpenAI request body into the pieces `genai` takes. Unknown keys are
/// preserved via `extra_body`, so a provider-specific parameter the agent grows
/// later does not silently vanish.
fn options_from_body(body: &serde_json::Value) -> ChatOptions {
    // `stop` (OpenAI) and `stop_sequences` (Anthropic-ish) both appear in bodies
    // the agent builds; either spelling can be a bare string or an array.
    let stop_sequences = match body.get("stop").or_else(|| body.get("stop_sequences")) {
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    };

    let extra: serde_json::Map<String, serde_json::Value> = EXTRA_BODY_KEYS
        .iter()
        .filter_map(|k| body.get(*k).map(|v| ((*k).to_string(), v.clone())))
        .collect();

    ChatOptions {
        temperature: body.get("temperature").and_then(|v| v.as_f64()),
        top_p: body.get("top_p").and_then(|v| v.as_f64()),
        max_tokens: body
            .get("max_tokens")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok()),
        seed: body.get("seed").and_then(|v| v.as_u64()),
        stop_sequences,
        reasoning_effort: body
            .get("reasoning_effort")
            .and_then(|v| v.as_str())
            .and_then(|s| match s.to_ascii_lowercase().as_str() {
                "none" | "zero" => Some(ReasoningEffort::Zero),
                "low" => Some(ReasoningEffort::Low),
                "medium" => Some(ReasoningEffort::Medium),
                "high" => Some(ReasoningEffort::High),
                "xhigh" => Some(ReasoningEffort::XHigh),
                _ => None,
            }),
        extra_body: (!extra.is_empty()).then(|| serde_json::Value::Object(extra)),
        // The reconstructed completion needs usage, the final content, and the
        // merged tool calls; reasoning is carried back on the assistant message
        // so a follow-up turn can resend it.
        capture_usage: Some(true),
        capture_content: Some(true),
        capture_tool_calls: Some(true),
        capture_reasoning_content: Some(true),
        // Providers that inline `<think>` tags in `content` instead of exposing a
        // reasoning field get normalized into reasoning events too, so consumers
        // see one shape regardless of provider.
        normalize_reasoning_content: Some(true),
        ..Default::default()
    }
}

/// Convert the agent's OpenAI `messages` array into `genai` messages.
///
/// `system` is lifted out of the array: `genai` carries it on the request rather
/// than as a message, and adapters place it where each provider wants it.
fn messages_from_body(
    body: &serde_json::Value,
) -> Result<(Option<String>, Vec<ChatMessage>), String> {
    let raw = body
        .get("messages")
        .and_then(|v| v.as_array())
        .ok_or("Request body must include 'messages' as an array")?;

    let mut system: Option<String> = None;
    let mut out: Vec<ChatMessage> = Vec::with_capacity(raw.len());

    for msg in raw {
        let role = msg
            .get("role")
            .and_then(|v| v.as_str())
            .ok_or("Each message must include a string 'role'")?;
        let content = msg.get("content");

        match role {
            "system" | "developer" => {
                let text = content_text(content);
                // Several system turns concatenate rather than the last winning,
                // which would silently drop an earlier instruction.
                system = Some(match system.take() {
                    Some(prev) if !prev.is_empty() => format!("{prev}\n\n{text}"),
                    _ => text,
                });
            }
            "tool" => {
                let call_id = msg
                    .get("tool_call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                out.push(ChatMessage::new(
                    ChatRole::Tool,
                    ToolResponse::new(call_id, content_text(content)),
                ));
            }
            "assistant" => {
                let mut parts: Vec<ContentPart> = Vec::new();
                // Reasoning first: adapters hoist it back into the provider's
                // sibling field, and its position relative to text is not
                // meaningful.
                if let Some(r) = msg
                    .get("reasoning_content")
                    .or_else(|| msg.get("reasoning"))
                    .and_then(|v| v.as_str())
                    .filter(|r| !r.is_empty())
                {
                    parts.push(ContentPart::ReasoningContent(r.to_string()));
                }
                let text = content_text(content);
                if !text.is_empty() {
                    parts.push(ContentPart::Text(text));
                }
                for tc in msg
                    .get("tool_calls")
                    .and_then(|v| v.as_array())
                    .map(|a| a.as_slice())
                    .unwrap_or_default()
                {
                    parts.push(ContentPart::ToolCall(tool_call_from_json(tc)));
                }
                // A turn with no text, no reasoning and no calls would serialize
                // to an empty assistant message, which some providers reject.
                if parts.is_empty() {
                    continue;
                }
                out.push(ChatMessage::new(
                    ChatRole::Assistant,
                    parts.into_iter().collect::<MessageContent>(),
                ));
            }
            // Everything else is a user turn. Multimodal content-part arrays are
            // flattened to their text; images are not yet forwarded (see below).
            _ => {
                out.push(ChatMessage::new(
                    ChatRole::User,
                    content_text(content),
                ));
            }
        }
    }

    Ok((system, out))
}

/// Text of an OpenAI `content` field: a bare string, or the concatenated `text`
/// parts of a multimodal array. Non-text parts (`image_url`) are skipped.
fn content_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// Rebuild a `genai` tool call from the OpenAI JSON shape the agent persists.
///
/// `arguments` is a JSON *string* on the wire. It is parsed so `genai` can
/// re-serialize it, and left as a string value when it does not parse -- a
/// truncated argument is preserved verbatim rather than being turned into
/// something the model never emitted.
fn tool_call_from_json(tc: &serde_json::Value) -> ToolCall {
    let func = tc.get("function");
    let raw_args = func
        .and_then(|f| f.get("arguments"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let fn_arguments = if raw_args.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(raw_args)
            .unwrap_or_else(|_| serde_json::Value::String(raw_args.to_string()))
    };
    ToolCall {
        call_id: tc
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        fn_name: func
            .and_then(|f| f.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        fn_arguments,
        thought_signatures: None,
    }
}

/// Convert the agent's OpenAI `tools` array into `genai` tools.
fn tools_from_body(body: &serde_json::Value) -> Option<Vec<Tool>> {
    let raw = body.get("tools").and_then(|v| v.as_array())?;
    let tools: Vec<Tool> = raw
        .iter()
        .filter_map(|t| {
            let func = t.get("function")?;
            let name = func.get("name").and_then(|v| v.as_str())?;
            let mut tool = Tool::new(name.to_string());
            if let Some(desc) = func.get("description").and_then(|v| v.as_str()) {
                tool = tool.with_description(desc.to_string());
            }
            if let Some(params) = func.get("parameters") {
                tool = tool.with_schema(params.clone());
            }
            Some(tool)
        })
        .collect();
    (!tools.is_empty()).then_some(tools)
}

/// Build the full `genai` request from an OpenAI body.
fn chat_request_from_body(body: &serde_json::Value) -> Result<(String, ChatRequest), String> {
    let model = body
        .get("model")
        .and_then(|v| v.as_str())
        .ok_or("Request body must include 'model'")?
        .to_string();

    let (system, messages) = messages_from_body(body)?;
    let mut req = ChatRequest::new(messages);
    req.system = system;
    req.tools = tools_from_body(body);
    Ok((model, req))
}

/// Attempts per API key, per the "10 retries with increasing backoff" policy.
const MAX_ATTEMPTS: u32 = 10;
/// First backoff; doubles per attempt up to [`MAX_RETRY_DELAY`].
const BASE_RETRY_DELAY: Duration = Duration::from_millis(250);
/// Backoff ceiling. Unbounded doubling over 10 attempts would idle for ~4
/// minutes, which a user reads as a hang rather than a retry.
const MAX_RETRY_DELAY: Duration = Duration::from_secs(8);
/// Total time that may be spent *waiting* between attempts. Bounds the worst
/// case regardless of attempt count or a hostile `Retry-After`.
const RETRY_BUDGET: Duration = Duration::from_secs(45);

/// What to do about a failed attempt.
enum Disposition {
    /// Retry the same key after a backoff.
    Retry,
    /// The key was rejected; move to the next key in the chain.
    NextKey,
    /// Nothing will help.
    Fatal,
}

/// HTTP statuses worth another attempt: rate limiting and the transient 5xx
/// family a load balancer emits while a backend recycles. A 4xx other than 429
/// is a request the upstream will reject identically forever.
fn disposition_for_status(status: u16) -> Disposition {
    match status {
        401 | 403 => Disposition::NextKey,
        // 429 can be either: with more keys it's worth rotating, and retrying the
        // same key after a delay is the documented remedy. Rotation is preferred
        // (see the caller) and this is the fallback when the chain is exhausted.
        429 => Disposition::Retry,
        408 | 409 | 425 => Disposition::Retry,
        s if (500..600).contains(&s) => Disposition::Retry,
        _ => Disposition::Fatal,
    }
}

/// A provider-requested delay, honored when it is present and sane.
/// `retry-after-ms` wins over `retry-after` (it is more precise); a date-form
/// `Retry-After` is ignored rather than parsed.
fn provider_retry_after(headers: &reqwest13::header::HeaderMap) -> Option<Duration> {
    let ms = headers
        .get("retry-after-ms")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(Duration::from_millis);
    ms.or_else(|| {
        headers
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .map(Duration::from_secs)
    })
}

/// Pull the HTTP status, response body, and headers out of whichever error shape
/// `genai` used. Kept in one place because the same failure arrives as
/// `HttpError`, `WebModelCall`, or `WebAdapterCall` depending on the call stage.
fn http_parts(err: &genai::Error) -> (Option<u16>, Option<&str>, Option<&reqwest13::header::HeaderMap>) {
    use genai::webc::Error as WebcError;
    match err {
        genai::Error::HttpError {
            status,
            body,
            headers,
            ..
        } => (Some(status.as_u16()), Some(body.as_str()), Some(headers)),
        // The streaming path never returns `HttpError` directly: a non-2xx is
        // boxed inside `WebStream`, so without this unwrap every status looks
        // like a transport failure and a plain 400 would be retried to death.
        genai::Error::WebStream { error, .. } => match error.downcast_ref::<genai::Error>() {
            Some(inner) => http_parts(inner),
            None => (None, None, None),
        },
        genai::Error::WebModelCall { webc_error, .. }
        | genai::Error::WebAdapterCall { webc_error, .. } => match webc_error {
            WebcError::ResponseFailedStatus {
                status,
                body,
                headers,
            } => (Some(status.as_u16()), Some(body.as_str()), Some(headers)),
            other => (other.status().map(|s| s.as_u16()), None, None),
        },
        _ => (err.status().map(|s| s.as_u16()), None, None),
    }
}

/// Every message in an error's `source()` chain, outermost cause first, with
/// consecutive duplicates collapsed. A transport failure's real reason (DNS,
/// refused connection, TLS mismatch) is several opaque layers below the message
/// `genai` prints, and is otherwise lost to the user.
fn error_source_chain(err: &dyn std::error::Error) -> Vec<String> {
    let mut chain = Vec::new();
    let mut cur = err.source();
    while let Some(e) = cur {
        let msg = e.to_string();
        if !msg.trim().is_empty() && chain.last() != Some(&msg) {
            chain.push(msg);
        }
        cur = e.source();
    }
    chain
}

/// A failed upstream call described well enough to act on: the `genai` message,
/// its whole cause chain, and the HTTP status when there was a response.
fn describe_error(err: &genai::Error) -> String {
    let mut msg = err.to_string();
    let chain = error_source_chain(err);
    if !chain.is_empty() {
        msg.push_str(&format!(" (caused by: {})", chain.join(" <- ")));
    }
    msg
}

/// Reconstruct the OpenAI non-streaming completion the agent loop expects.
/// `genai`'s typed result is collapsed back to JSON here rather than at every
/// call site, so `core::agent::loop` keeps reading the shape it persists.
fn completion_json(
    content: String,
    reasoning: String,
    tool_calls: Vec<serde_json::Value>,
    finish_reason: Option<&str>,
    usage: Option<&genai::chat::Usage>,
) -> serde_json::Value {
    let mut message = serde_json::Map::new();
    message.insert("role".into(), serde_json::json!("assistant"));
    message.insert(
        "content".into(),
        if content.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::json!(content)
        },
    );
    // Reasoning stays out of `content` but rides on the message so a caller that
    // resends assistant turns can forward it. Empty is omitted, so a
    // non-reasoning provider produces an unchanged shape.
    if !reasoning.is_empty() {
        message.insert("reasoning_content".into(), serde_json::json!(reasoning));
    }
    if !tool_calls.is_empty() {
        message.insert("tool_calls".into(), serde_json::Value::Array(tool_calls));
    }

    let mut choice = serde_json::Map::new();
    choice.insert("index".into(), serde_json::json!(0));
    choice.insert("message".into(), serde_json::Value::Object(message));
    choice.insert(
        "finish_reason".into(),
        finish_reason
            .map(|s| serde_json::json!(s))
            .unwrap_or(serde_json::Value::Null),
    );

    let mut completion = serde_json::Map::new();
    completion.insert(
        "choices".into(),
        serde_json::Value::Array(vec![serde_json::Value::Object(choice)]),
    );
    if let Some(u) = usage {
        let mut usage_obj = serde_json::Map::new();
        if let Some(v) = u.prompt_tokens {
            usage_obj.insert("prompt_tokens".into(), serde_json::json!(v));
        }
        if let Some(v) = u.completion_tokens {
            usage_obj.insert("completion_tokens".into(), serde_json::json!(v));
        }
        if let Some(v) = u.total_tokens {
            usage_obj.insert("total_tokens".into(), serde_json::json!(v));
        }
        if !usage_obj.is_empty() {
            completion.insert("usage".into(), serde_json::Value::Object(usage_obj));
        }
    }
    serde_json::Value::Object(completion)
}

/// Map `genai`'s normalized stop reason back onto the OpenAI `finish_reason`
/// vocabulary the agent loop branches on (notably `length`, which fails
/// truncated tool calls, and `tool_calls`).
fn finish_reason_str(reason: Option<&genai::chat::StopReason>) -> Option<&'static str> {
    use genai::chat::StopReason;
    reason.map(|r| match r {
        StopReason::Completed(_) => "stop",
        StopReason::MaxTokens(_) => "length",
        StopReason::ToolCall(_) => "tool_calls",
        StopReason::ContentFilter(_) => "content_filter",
        StopReason::StopSequence(_) => "stop",
        StopReason::Other(_) => "stop",
    })
}

/// Tracks a streaming tool call so `ToolCallStarted` fires once and
/// `ToolCallArgsDelta` carries only new bytes.
#[derive(Default)]
struct ToolCallProgress {
    started: bool,
    forwarded: usize,
}

/// Stream one chat completion, emitting [`StreamEvent`]s as tokens arrive and
/// returning the reconstructed completion JSON.
///
/// Retries live here rather than at the HTTP layer: only at this level are both
/// the provider's status/`Retry-After` and "has anything been streamed yet"
/// visible. A retry is attempted **only before the first event reaches the
/// consumer** -- afterwards a second attempt would duplicate visible output.
pub(crate) async fn stream_chat_completions(
    http: &reqwest13::Client,
    upstream_url: &str,
    api_keys: &[String],
    api_type: Option<&str>,
    body: &serde_json::Value,
    events: &mpsc::UnboundedSender<StreamEvent>,
) -> Result<serde_json::Value, String> {
    let (model, chat_req) = chat_request_from_body(body)?;
    let options = options_from_body(body);
    let endpoint_base = endpoint_base_from_chat_url(upstream_url);
    let adapter = adapter_kind_for(api_type);

    let keys: Vec<Option<&str>> = if api_keys.is_empty() {
        vec![None]
    } else {
        api_keys.iter().map(|k| Some(k.as_str())).collect()
    };

    let mut spent = Duration::ZERO;
    let mut last_err = String::from("Upstream request failed");

    for (key_index, key) in keys.iter().enumerate() {
        let client = client_for(http, &endpoint_base, upstream_url, *key, adapter);

        for attempt in 0..MAX_ATTEMPTS {
            let mut progressed = false;
            match run_once(
                &client,
                &model,
                chat_req.clone(),
                &options,
                events,
                &mut progressed,
            )
            .await
            {
                Ok(completion) => return Ok(completion),
                Err(err) => {
                    let (status, err_body, headers) = http_parts(&err);
                    let described = describe_error(&err);
                    last_err = match status {
                        Some(s) => format!("Upstream returned HTTP {s}: {described}"),
                        None => format!("Upstream request failed: {described}"),
                    };
                    // A context overflow is not a transport problem: the caller
                    // compacts and retries the turn itself, so mark it and stop.
                    let overflow_text = err_body.unwrap_or(described.as_str());
                    if super::upstream::is_context_overflow_body(overflow_text) {
                        return Err(format!(
                            "[{}] {last_err}",
                            super::upstream::CONTEXT_OVERFLOW_MARKER
                        ));
                    }

                    // Anything already streamed to the consumer makes a retry
                    // unsafe -- it would replay tokens the user has seen.
                    if progressed {
                        return Err(last_err);
                    }

                    let disposition = match status {
                        Some(s) => disposition_for_status(s),
                        // No HTTP response at all: connect failure, timeout, or a
                        // stream that died before its first event. Nothing was
                        // received, so another attempt is safe.
                        None => Disposition::Retry,
                    };

                    match disposition {
                        Disposition::Fatal => return Err(last_err),
                        Disposition::NextKey => {
                            if key_index + 1 < keys.len() {
                                log::warn!(
                                    "genai: HTTP {} with API key index {key_index}, trying next key",
                                    status.unwrap_or(0)
                                );
                            }
                            break;
                        }
                        Disposition::Retry if attempt + 1 == MAX_ATTEMPTS => {
                            return Err(format!("{last_err} (after {MAX_ATTEMPTS} attempts)"));
                        }
                        Disposition::Retry => {
                            // A 429 with more keys available rotates rather than
                            // waiting: another key usually has its own quota.
                            if status == Some(429) && key_index + 1 < keys.len() {
                                break;
                            }
                            let delay = next_delay(attempt, headers.and_then(provider_retry_after));
                            let Some(delay) = budgeted(delay, spent) else {
                                return Err(format!("{last_err} (retry budget exhausted)"));
                            };
                            spent += delay;
                            log::warn!(
                                "genai: {last_err} -- retrying in {}ms (attempt {}/{MAX_ATTEMPTS})",
                                delay.as_millis(),
                                attempt + 2
                            );
                            tokio::time::sleep(delay).await;
                        }
                    }
                }
            }
        }
    }

    Err(last_err)
}

/// Exponential backoff for `attempt` (0-based), capped, with a provider-supplied
/// delay taking precedence when it is longer than what we'd have waited anyway.
fn next_delay(attempt: u32, provider: Option<Duration>) -> Duration {
    let backoff = BASE_RETRY_DELAY
        .saturating_mul(1u32 << attempt.min(15))
        .min(MAX_RETRY_DELAY);
    match provider {
        Some(p) if p > backoff => p,
        _ => backoff,
    }
}

/// Clamp a delay to what remains of [`RETRY_BUDGET`]; `None` when nothing does.
fn budgeted(delay: Duration, spent: Duration) -> Option<Duration> {
    let remaining = RETRY_BUDGET.checked_sub(spent)?;
    if remaining.is_zero() {
        return None;
    }
    Some(delay.min(remaining))
}

/// One attempt: drive the stream to completion, emitting events as they arrive.
/// Sets `progressed` as soon as anything has been handed to the consumer, which
/// makes the attempt non-retryable.
async fn run_once(
    client: &Client,
    model: &str,
    chat_req: ChatRequest,
    options: &ChatOptions,
    events: &mpsc::UnboundedSender<StreamEvent>,
    progressed: &mut bool,
) -> Result<serde_json::Value, genai::Error> {
    let response = client
        .exec_chat_stream(model, chat_req, Some(options))
        .await?;
    let mut stream = response.stream;

    let mut content = String::new();
    let mut reasoning = String::new();
    let mut calls: std::collections::HashMap<String, ToolCallProgress> = Default::default();
    let mut final_calls: Vec<serde_json::Value> = Vec::new();
    let mut finish: Option<&'static str> = None;
    let mut usage: Option<genai::chat::Usage> = None;

    while let Some(event) = stream.next().await {
        match event? {
            ChatStreamEvent::Start | ChatStreamEvent::Heartbeat => {}
            ChatStreamEvent::Chunk(chunk) => {
                if !chunk.content.is_empty() {
                    content.push_str(&chunk.content);
                    *progressed = true;
                    let _ = events.send(StreamEvent::Token {
                        text: chunk.content,
                    });
                }
            }
            ChatStreamEvent::ReasoningChunk(chunk) => {
                if !chunk.content.is_empty() {
                    reasoning.push_str(&chunk.content);
                    *progressed = true;
                    let _ = events.send(StreamEvent::Reasoning {
                        text: chunk.content,
                    });
                }
            }
            // Signals for the in-progress UI only; the authoritative, merged
            // calls come from `StreamEnd` below.
            ChatStreamEvent::ToolCallChunk(chunk) => {
                let tc = chunk.tool_call;
                if tc.call_id.is_empty() {
                    continue;
                }
                let progress = calls.entry(tc.call_id.clone()).or_default();
                if !progress.started && !tc.fn_name.is_empty() {
                    progress.started = true;
                    *progressed = true;
                    let _ = events.send(StreamEvent::ToolCallStarted {
                        id: tc.call_id.clone(),
                        name: tc.fn_name.clone(),
                    });
                }
                // genai emits the *accumulated* arguments each chunk, so forward
                // only the part the consumer has not seen. Deltas, not prefixes:
                // resending the whole buffer is quadratic in a file-sized write.
                if progress.started {
                    if let Some(acc) = tc.fn_arguments.as_str() {
                        if acc.len() > progress.forwarded {
                            let delta = acc[progress.forwarded..].to_string();
                            progress.forwarded = acc.len();
                            let _ = events.send(StreamEvent::ToolCallArgsDelta {
                                id: tc.call_id,
                                delta,
                            });
                        }
                    }
                }
            }
            ChatStreamEvent::ThoughtSignatureChunk(_) => {}
            ChatStreamEvent::End(end) => {
                finish = finish_reason_str(end.captured_stop_reason.as_ref());
                usage = end.captured_usage.clone();
                if let Some(tool_calls) = end.captured_tool_calls() {
                    final_calls = tool_calls
                        .into_iter()
                        .map(|tc| {
                            // Arguments go back on the wire as a JSON string,
                            // which is what the loop parses and re-sends.
                            let args = match &tc.fn_arguments {
                                serde_json::Value::String(s) => s.clone(),
                                other => other.to_string(),
                            };
                            serde_json::json!({
                                "id": tc.call_id,
                                "type": "function",
                                "function": { "name": tc.fn_name, "arguments": args }
                            })
                        })
                        .collect();
                }
                // A provider that streamed content but reported nothing at the
                // end still needs the text captured above.
                if content.is_empty() {
                    if let Some(text) = end.captured_first_text() {
                        content = text.to_string();
                    }
                }
                if reasoning.is_empty() {
                    if let Some(r) = end.captured_reasoning_content.as_deref() {
                        reasoning = r.to_string();
                    }
                }
            }
        }
    }

    Ok(completion_json(
        content,
        reasoning,
        final_calls,
        finish,
        usage.as_ref(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The trailing slash is load-bearing: `Url::join` would otherwise replace
    /// the last segment and drop the API version from the path.
    #[test]
    fn endpoint_base_keeps_the_version_segment_and_trailing_slash() {
        for (input, want) in [
            (
                "https://api.tokamak.sh/v1/chat/completions",
                "https://api.tokamak.sh/v1/",
            ),
            (
                "http://127.0.0.1:1337/v1/chat/completions",
                "http://127.0.0.1:1337/v1/",
            ),
            // Already a base (no suffix to strip).
            ("https://api.example.com/v1", "https://api.example.com/v1/"),
            // Redundant trailing slash must not produce a doubled one.
            (
                "https://api.example.com/v1/chat/completions/",
                "https://api.example.com/v1/",
            ),
        ] {
            assert_eq!(endpoint_base_from_chat_url(input), want, "for {input}");
        }
    }

    #[test]
    fn api_type_selects_the_adapter_and_defaults_to_openai() {
        assert_eq!(adapter_kind_for(None), AdapterKind::OpenAI);
        assert_eq!(adapter_kind_for(Some("openai")), AdapterKind::OpenAI);
        assert_eq!(adapter_kind_for(Some("anthropic")), AdapterKind::Anthropic);
        assert_eq!(adapter_kind_for(Some("google")), AdapterKind::Gemini);
        // An unknown value must not fail the turn -- OpenAI-compatible is the
        // shape every configured provider actually serves.
        assert_eq!(adapter_kind_for(Some("who-knows")), AdapterKind::OpenAI);
    }

    #[test]
    fn system_messages_are_lifted_out_and_concatenated() {
        let body = json!({
            "model": "m",
            "messages": [
                { "role": "system", "content": "be terse" },
                { "role": "user", "content": "hi" },
                { "role": "system", "content": "and precise" },
            ]
        });
        let (_, req) = chat_request_from_body(&body).unwrap();
        assert_eq!(req.system.as_deref(), Some("be terse\n\nand precise"));
        assert_eq!(req.messages.len(), 1, "only the user turn remains");
    }

    #[test]
    fn assistant_reasoning_and_tool_calls_survive_the_round_trip() {
        let body = json!({
            "model": "m",
            "messages": [{
                "role": "assistant",
                "content": "calling",
                "reasoning_content": "i should look it up",
                "tool_calls": [{
                    "id": "call_abc",
                    "type": "function",
                    "function": { "name": "grep", "arguments": "{\"q\":\"x\"}" }
                }]
            }]
        });
        let (_, req) = chat_request_from_body(&body).unwrap();
        let parts: Vec<&ContentPart> = req.messages[0].content.iter().collect();

        assert!(
            parts
                .iter()
                .any(|p| matches!(p, ContentPart::ReasoningContent(r) if r == "i should look it up")),
            "reasoning is carried so the adapter can resend it: {parts:?}"
        );
        let call = parts
            .iter()
            .find_map(|p| match p {
                ContentPart::ToolCall(tc) => Some(tc),
                _ => None,
            })
            .expect("tool call preserved");
        assert_eq!(call.call_id, "call_abc");
        assert_eq!(call.fn_name, "grep");
        // Parsed, not left as a string, so genai re-serializes real JSON.
        assert_eq!(call.fn_arguments, json!({ "q": "x" }));
    }

    /// A truncated argument cannot be parsed. Keeping the raw text beats
    /// inventing an object the model never emitted.
    #[test]
    fn unparsable_tool_arguments_are_kept_verbatim() {
        let tc = json!({
            "id": "c1",
            "function": { "name": "write", "arguments": "{\"path\": \"a.txt" }
        });
        assert_eq!(
            tool_call_from_json(&tc).fn_arguments,
            json!("{\"path\": \"a.txt")
        );
    }

    #[test]
    fn absent_tool_arguments_become_an_empty_object() {
        let tc = json!({ "id": "c1", "function": { "name": "ls", "arguments": "" } });
        assert_eq!(tool_call_from_json(&tc).fn_arguments, json!({}));
    }

    #[test]
    fn tool_result_messages_become_tool_responses() {
        let body = json!({
            "model": "m",
            "messages": [
                { "role": "tool", "tool_call_id": "call_abc", "content": "42" }
            ]
        });
        let (_, req) = chat_request_from_body(&body).unwrap();
        assert!(matches!(req.messages[0].role, ChatRole::Tool));
        let parts: Vec<&ContentPart> = req.messages[0].content.iter().collect();
        assert!(
            parts.iter().any(|p| matches!(
                p,
                ContentPart::ToolResponse(tr) if tr.call_id == "call_abc" && tr.content == "42"
            )),
            "tool result keyed by call id: {parts:?}"
        );
    }

    #[test]
    fn multimodal_content_parts_are_flattened_to_their_text() {
        let body = json!({
            "model": "m",
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "text", "text": "look: " },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAA" } },
                    { "type": "text", "text": "what is it?" }
                ]
            }]
        });
        let (_, req) = chat_request_from_body(&body).unwrap();
        let parts: Vec<&ContentPart> = req.messages[0].content.iter().collect();
        assert!(
            parts
                .iter()
                .any(|p| matches!(p, ContentPart::Text(t) if t == "look: what is it?")),
            "text parts joined: {parts:?}"
        );
    }

    #[test]
    fn non_standard_params_ride_through_extra_body() {
        let body = json!({
            "model": "m",
            "messages": [],
            "temperature": 0.4,
            "top_p": 0.9,
            "max_tokens": 256,
            "top_k": 40,
            "stop": ["<end>"],
            "reasoning_effort": "high"
        });
        let options = options_from_body(&body);
        assert_eq!(options.temperature, Some(0.4));
        assert_eq!(options.top_p, Some(0.9));
        assert_eq!(options.max_tokens, Some(256));
        assert_eq!(options.stop_sequences, vec!["<end>".to_string()]);
        assert!(matches!(
            options.reasoning_effort,
            Some(ReasoningEffort::High)
        ));
        // `top_k` has no typed home; it must still reach llama.cpp / vLLM.
        assert_eq!(
            options.extra_body.as_ref().and_then(|b| b.get("top_k")),
            Some(&json!(40))
        );
    }

    #[test]
    fn a_bare_string_stop_is_accepted_as_well_as_an_array() {
        let body = json!({ "model": "m", "messages": [], "stop": "STOP" });
        assert_eq!(
            options_from_body(&body).stop_sequences,
            vec!["STOP".to_string()]
        );
    }

    #[test]
    fn tools_carry_their_schema_across() {
        let body = json!({
            "model": "m",
            "messages": [],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "grep",
                    "description": "search",
                    "parameters": { "type": "object", "properties": { "q": { "type": "string" } } }
                }
            }]
        });
        let (_, req) = chat_request_from_body(&body).unwrap();
        let tools = req.tools.expect("tools converted");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name.as_str(), "grep");
        assert_eq!(tools[0].description.as_deref(), Some("search"));
        assert_eq!(
            tools[0].schema.as_ref().and_then(|s| s.get("type")),
            Some(&json!("object"))
        );
    }

    #[test]
    fn a_body_without_a_model_or_messages_is_rejected() {
        assert!(chat_request_from_body(&json!({ "messages": [] })).is_err());
        assert!(chat_request_from_body(&json!({ "model": "m" })).is_err());
    }

    // -- End-to-end: a real socket, real SSE bytes, the real genai stack.
    // The conversion tests above prove the mapping; these prove the wire.

    fn sink() -> (
        mpsc::UnboundedSender<StreamEvent>,
        mpsc::UnboundedReceiver<StreamEvent>,
    ) {
        mpsc::unbounded_channel()
    }

    fn sse_response(events: &[&str]) -> String {
        let body: String = events.iter().map(|e| format!("data: {e}\n\n")).collect();
        let body = format!("{body}data: [DONE]\n\n");
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    fn status_response(status: u16, reason: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    /// Serve one canned reply per connection, in order. `None` accepts the
    /// request then hangs up without a byte -- what a reclaimed pooled
    /// connection looks like from the client side.
    async fn serve(replies: Vec<Option<String>>) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let handle = tokio::spawn(async move {
            let mut open = Vec::new();
            for reply in replies {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let mut scratch = [0u8; 8192];
                let _ = sock.read(&mut scratch).await;
                match reply {
                    Some(bytes) => {
                        let _ = sock.write_all(bytes.as_bytes()).await;
                        let _ = sock.flush().await;
                        // Graceful FIN, not an abrupt drop: closing the socket
                        // outright can RST away bytes the client has not read.
                        let _ = sock.shutdown().await;
                        open.push(sock);
                    }
                    None => drop(sock),
                }
            }
        });
        (format!("http://{addr}/v1/chat/completions"), handle)
    }

    fn body() -> serde_json::Value {
        json!({ "model": "m", "messages": [{ "role": "user", "content": "hi" }] })
    }

    async fn run(url: &str, keys: &[String], events: &mpsc::UnboundedSender<StreamEvent>)
        -> Result<serde_json::Value, String> {
        stream_chat_completions(&build_http_client(), url, keys, None, &body(), events).await
    }

    #[tokio::test]
    async fn streams_tokens_and_reconstructs_the_completion() {
        let (url, server) = serve(vec![Some(sse_response(&[
            r#"{"choices":[{"delta":{"content":"He"}}]}"#,
            r#"{"choices":[{"delta":{"content":"llo"}}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}"#,
        ]))])
        .await;

        let (tx, mut rx) = sink();
        let completion = run(&url, &[], &tx).await.expect("stream succeeds");

        assert_eq!(completion["choices"][0]["message"]["content"], "Hello");
        assert_eq!(completion["choices"][0]["finish_reason"], "stop");
        assert_eq!(completion["usage"]["total_tokens"], 5);

        drop(tx);
        let mut tokens = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            if let StreamEvent::Token { text } = ev {
                tokens.push(text);
            }
        }
        assert_eq!(tokens, vec!["He", "llo"]);
        server.await.expect("server");
    }

    /// The whole reason for this migration: vLLM (and so `tokamak-1-preview`)
    /// spells the field `reasoning`, not `reasoning_content`. genai accepts both
    /// and normalizes, so the reasoning pane is no longer empty for Tokamak.
    #[tokio::test]
    async fn bare_reasoning_deltas_surface_as_reasoning_events() {
        let (url, server) = serve(vec![Some(sse_response(&[
            r#"{"choices":[{"delta":{"reasoning":"We"}}]}"#,
            r#"{"choices":[{"delta":{"reasoning":" need 391"}}]}"#,
            r#"{"choices":[{"delta":{"content":"391"}}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        ]))])
        .await;

        let (tx, mut rx) = sink();
        let completion = run(&url, &[], &tx).await.expect("stream succeeds");

        assert_eq!(completion["choices"][0]["message"]["content"], "391");
        assert_eq!(
            completion["choices"][0]["message"]["reasoning_content"],
            "We need 391",
            "normalized onto the canonical spelling: {completion}"
        );

        drop(tx);
        let (mut reasoning, mut tokens) = (Vec::new(), Vec::new());
        while let Ok(ev) = rx.try_recv() {
            match ev {
                StreamEvent::Reasoning { text } => reasoning.push(text),
                StreamEvent::Token { text } => tokens.push(text),
                _ => {}
            }
        }
        assert_eq!(reasoning, vec!["We", " need 391"]);
        assert_eq!(tokens, vec!["391"], "reasoning never leaks into content");
        server.await.expect("server");
    }

    #[tokio::test]
    async fn tool_call_arguments_stream_as_deltas_and_land_in_the_completion() {
        let (url, server) = serve(vec![Some(sse_response(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"grep","arguments":""}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"x\"}"}}]}}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        ]))])
        .await;

        let (tx, mut rx) = sink();
        let completion = run(&url, &[], &tx).await.expect("stream succeeds");

        assert_eq!(completion["choices"][0]["finish_reason"], "tool_calls");
        let call = &completion["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(call["id"], "call_1");
        assert_eq!(call["function"]["name"], "grep");
        // Arguments go back as a JSON *string*, which is what the loop parses.
        assert_eq!(call["function"]["arguments"], r#"{"q":"x"}"#);

        drop(tx);
        let (mut started, mut args) = (Vec::new(), String::new());
        while let Ok(ev) = rx.try_recv() {
            match ev {
                StreamEvent::ToolCallStarted { id, name } => started.push((id, name)),
                StreamEvent::ToolCallArgsDelta { delta, .. } => args.push_str(&delta),
                _ => {}
            }
        }
        assert_eq!(started, vec![("call_1".to_string(), "grep".to_string())],
            "announced exactly once");
        // Deltas, not prefixes: concatenating them must rebuild the arguments
        // rather than repeating them.
        assert_eq!(args, r#"{"q":"x"}"#);
        server.await.expect("server");
    }

    /// A connection reclaimed while the agent ran tools is the classic long-turn
    /// failure. Nothing was streamed, so the retry is safe -- and must not
    /// duplicate the answer.
    #[tokio::test]
    async fn a_dropped_first_connection_is_retried_and_streams_once() {
        let (url, server) = serve(vec![
            None,
            Some(sse_response(&[
                r#"{"choices":[{"delta":{"content":"hi"}}]}"#,
                r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
            ])),
        ])
        .await;

        let (tx, mut rx) = sink();
        let completion = run(&url, &[], &tx).await.expect("the retry carries the turn");
        assert_eq!(completion["choices"][0]["message"]["content"], "hi");

        drop(tx);
        let tokens: Vec<String> = std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|ev| match ev {
                StreamEvent::Token { text } => Some(text),
                _ => None,
            })
            .collect();
        assert_eq!(tokens, vec!["hi".to_string()], "streamed once, not twice");
        server.await.expect("server");
    }

    /// 401 rotates to the next key rather than burning retries on a key the
    /// upstream has already rejected.
    #[tokio::test]
    async fn an_unauthorized_key_falls_through_to_the_next_key() {
        let (url, server) = serve(vec![
            Some(status_response(401, "Unauthorized", r#"{"error":"bad key"}"#)),
            Some(sse_response(&[
                r#"{"choices":[{"delta":{"content":"ok"}}]}"#,
                r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
            ])),
        ])
        .await;

        let (tx, _rx) = sink();
        let completion = run(&url, &["dead".into(), "live".into()], &tx)
            .await
            .expect("second key works");
        assert_eq!(completion["choices"][0]["message"]["content"], "ok");
        server.await.expect("server");
    }

    /// Guard against the whole status-detection path silently regressing: with a
    /// single key and a single 401 reply queued, a spurious retry would hit a
    /// closed listener and report a transport error instead. Asserting the 401
    /// itself surfaces proves the status was read, not that a later attempt
    /// happened to succeed.
    #[tokio::test]
    async fn an_unauthorized_status_is_reported_not_retried_away() {
        let (url, server) = serve(vec![Some(status_response(
            401,
            "Unauthorized",
            r#"{"error":"bad key"}"#,
        ))])
        .await;

        let (tx, _rx) = sink();
        let err = run(&url, &["only".into()], &tx)
            .await
            .expect_err("a rejected key fails the turn");
        assert!(
            err.contains("401"),
            "the status reached the caller rather than being masked by a retry: {err}"
        );
        server.await.expect("server");
    }

    /// A 4xx that is not an auth or rate-limit problem is the same on every
    /// attempt, so it must fail immediately rather than spending the budget.
    #[tokio::test]
    async fn a_bad_request_is_not_retried() {
        let (url, server) = serve(vec![Some(status_response(
            400,
            "Bad Request",
            r#"{"error":{"message":"nope"}}"#,
        ))])
        .await;

        let (tx, _rx) = sink();
        let err = run(&url, &[], &tx).await.expect_err("400 is fatal");
        assert!(err.contains("400"), "status surfaces to the caller: {err}");
        server.await.expect("server");
    }

    #[test]
    fn backoff_grows_then_holds_at_the_ceiling() {
        assert_eq!(next_delay(0, None), BASE_RETRY_DELAY);
        assert_eq!(next_delay(1, None), BASE_RETRY_DELAY * 2);
        assert_eq!(next_delay(20, None), MAX_RETRY_DELAY, "capped, not overflowing");
    }

    #[test]
    fn a_provider_retry_after_wins_only_when_it_is_longer() {
        let long = Duration::from_secs(30);
        assert_eq!(next_delay(0, Some(long)), long);
        // A provider asking for less than our backoff does not get to make us
        // hammer it faster than we would have.
        assert_eq!(next_delay(5, Some(Duration::from_millis(1))), MAX_RETRY_DELAY);
    }

    #[test]
    fn the_retry_budget_clamps_and_then_gives_up() {
        assert_eq!(
            budgeted(Duration::from_secs(10), RETRY_BUDGET - Duration::from_secs(2)),
            Some(Duration::from_secs(2)),
            "clamped to what is left"
        );
        assert_eq!(budgeted(Duration::from_secs(1), RETRY_BUDGET), None);
    }

    #[test]
    fn only_transient_statuses_are_retried() {
        assert!(matches!(disposition_for_status(500), Disposition::Retry));
        assert!(matches!(disposition_for_status(503), Disposition::Retry));
        assert!(matches!(disposition_for_status(429), Disposition::Retry));
        assert!(matches!(disposition_for_status(401), Disposition::NextKey));
        assert!(matches!(disposition_for_status(403), Disposition::NextKey));
        assert!(matches!(disposition_for_status(400), Disposition::Fatal));
        assert!(matches!(disposition_for_status(404), Disposition::Fatal));
        assert!(matches!(disposition_for_status(422), Disposition::Fatal));
    }
}
