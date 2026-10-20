//! The input half of the headless stream-json channel: newline-delimited JSON
//! read from stdin while a run is in flight.
//!
//! `--output-format stream-json` (see [`super::run_report`]) made a run
//! readable by a program. On its own that is a one-way mirror: the task is
//! baked into a single string before the process starts, a gated tool call can
//! only be denied because piped stdin has no terminal to ask, and the only way
//! to stop the run is to kill it. This module is the reply path -- the same
//! `{"type": ...}` framing in the other direction.
//!
//! Four kinds, matching the things a caller cannot otherwise say:
//! `user` (a follow-up joined to the run in flight at the next turn boundary,
//! via the orchestration loop's existing steering handshake), `abort`,
//! `permission` (a decision keyed to a `permission_request` already on stdout),
//! and `tool_result` (the answer to a `tool_request`, which is how a host
//! executes a tool this process cannot: see
//! [`crate::core::agent::host_tools`]).
//! [`INPUT_KINDS`] is that set as data: the `init` record advertises it, so a
//! client learns what it may send without being told out of band.
//! A line that parses as none of them is reported as an `input_error` record
//! and skipped: the reader is a peer process's output, so one bad line must not
//! be able to end a run that is otherwise healthy.
//!
//! A `user` line carries either `text` or `content`, an OpenAI content-part
//! array, so a client can send an image without a filesystem in common with the
//! run ([`super::user_message`] holds the shape both paths build). Parts are
//! passed through verbatim; the caps below are what a line is measured against
//! first, because an unbounded channel is a denial of service on the run.
//! A `tool_result` may answer with the same content-part array, under the same
//! caps, plus a `details` object that is echoed for displays and never sent to
//! the model.

use crate::core::agent::host_tools::HostToolResult;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use tokio::sync::Notify;

/// Most bytes one line may occupy. The reader stops accumulating at this point
/// and discards the rest of the line, so a client that sends a gigabyte costs
/// the cap in memory rather than the gigabyte.
pub(crate) const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

/// Most decoded bytes one `image_url` part may carry.
pub(crate) const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

/// Most decoded bytes across the images of one message.
pub(crate) const MAX_MESSAGE_IMAGE_BYTES: usize = 10 * 1024 * 1024;

/// Most images one message may carry.
pub(crate) const MAX_IMAGES: usize = 8;

/// Most bytes of a rejected line echoed back in `input_error`. A rejected line
/// may be as large as [`MAX_LINE_BYTES`], and echoing it whole would move the
/// cost the cap just removed from the parser onto the client's own reader.
pub(crate) const MAX_ECHO_BYTES: usize = 4 * 1024;

/// How a non-interactive run is spoken to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum InputFormat {
    /// The positional task is the whole conversation; stdin is not read.
    #[default]
    Text,
    /// Newline-delimited JSON messages on stdin, read for the run's lifetime.
    StreamJson,
}

impl InputFormat {
    pub(crate) fn is_stream_json(self) -> bool {
        matches!(self, InputFormat::StreamJson)
    }
}

/// The message kinds the input channel accepts, in the order they are
/// documented. One list, two readers: the rejection message below names them,
/// and the `init` record advertises them to a client that has not read the
/// docs. A kind added to the parser without a line here would be a capability
/// no client is told about, so a test pins the two together.
pub(crate) const INPUT_KINDS: [&str; 4] = ["user", "abort", "permission", "tool_result"];

/// One well-formed line from the client.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum InputMessage {
    /// A follow-up turn for the run in flight.
    User(String),
    /// A follow-up turn whose content is an OpenAI content-part array, already
    /// validated against the caps and passed through as the client wrote it.
    UserParts(Vec<serde_json::Value>),
    /// Stop the run; the terminal envelope still reports what it had produced.
    Abort,
    /// The answer to a `permission_request` this run emitted.
    Permission {
        request_id: String,
        decision: PermissionDecision,
    },
    /// The answer to a `tool_request` this run emitted: the host ran the tool
    /// and this is what the model should see.
    ToolResult {
        request_id: String,
        result: HostToolResult,
    },
}

/// One input line, as the wire shape: the [`INPUT_KINDS`], with the fields
/// each carries. The wire shape is a serde type rather than a hand-rolled walk
/// over a `Value` so the protocol schema can be derived from it -- `jan cli
/// agent schema` publishes this shape, and a hand-written copy of it would be
/// correct only until the parser moved.
///
/// The `type` field is read separately, before deserializing: an unknown kind is
/// reported against [`INPUT_KINDS`], which is the list `init` advertises.
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum InputLine {
    /// A follow-up turn for the run in flight: `text`, or `content` as an
    /// OpenAI content-part array. Exactly one of the two, which JSON Schema
    /// cannot state, so the doc says it and the parser enforces it. A
    /// content-part message carries text parts and `image_url` parts, whose URL
    /// is a base64 `data:` URL -- the run shares no filesystem with a client.
    User {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<Vec<serde_json::Value>>,
    },
    /// Stop the run; the terminal envelope still reports what it had produced.
    Abort,
    /// The answer to a `permission_request` this run emitted.
    Permission {
        request_id: String,
        decision: InputDecision,
    },
    /// The answer to a `tool_request` this run emitted: the host executed the
    /// tool and this is its result, which becomes the model's tool message.
    ///
    /// `content` is required even for a failure. A tool message with nothing in
    /// it tells the model only that something happened, which is worse than a
    /// short error. It is either a string or an OpenAI content-part array
    /// (`text` and `image_url` parts, under the same caps as a `user` message),
    /// so a camera can hand the model a frame.
    ///
    /// `details` is any JSON object the host wants a display to have. It is
    /// never sent to the model: the run echoes it as a `tool_details` record
    /// after the `tool_result`, and that is all.
    ToolResult {
        request_id: String,
        content: ToolResultContent,
        #[serde(default)]
        is_error: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        details: Option<serde_json::Map<String, serde_json::Value>>,
    },
}

/// A `tool_result`'s `content`: a plain string, or a content-part array.
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(untagged, expecting = "'content' to be a string or a content-part array")]
pub(crate) enum ToolResultContent {
    Text(String),
    Parts(Vec<serde_json::Value>),
}

/// What a text-only reader of a parts result sees: hooks, the `tool_result`
/// event and the `ERROR: ` prefix all work on text, so an image-only answer
/// still needs a line that says something arrived.
const IMAGE_ONLY_SUMMARY: &str = "(image)";

pub(crate) fn summarize_parts(parts: &[serde_json::Value]) -> String {
    let texts: Vec<&str> = parts
        .iter()
        .filter(|p| p.get("type").and_then(|v| v.as_str()) == Some("text"))
        .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
        .collect();
    if texts.is_empty() {
        IMAGE_ONLY_SUMMARY.to_string()
    } else {
        texts.join("\n")
    }
}

/// The decisions a client may answer a `permission_request` with: the wire
/// vocabulary, which [`parse_input_line`] maps onto the tool gate's own enum.
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InputDecision {
    AllowOnce,
    AllowAlways,
    Deny,
}

impl From<InputDecision> for PermissionDecision {
    fn from(decision: InputDecision) -> Self {
        match decision {
            InputDecision::AllowOnce => PermissionDecision::AllowOnce,
            InputDecision::AllowAlways => PermissionDecision::AllowAlways,
            InputDecision::Deny => PermissionDecision::Deny,
        }
    }
}

/// Parse one NDJSON line. The error is what the client is told on the stream,
/// so it names the offending value rather than just the expected shape.
pub(crate) fn parse_input_line(line: &str) -> Result<InputMessage, String> {
    let value: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("not JSON: {e}"))?;
    let Some(kind) = value.get("type").and_then(|v| v.as_str()) else {
        return Err("missing string field 'type'".to_string());
    };
    if !INPUT_KINDS.contains(&kind) {
        return Err(format!(
            "unknown type '{kind}' ({})",
            INPUT_KINDS.join(", ")
        ));
    }
    match serde_json::from_value::<InputLine>(value).map_err(|e| e.to_string())? {
        InputLine::User { text, content } => match (text, content) {
            (Some(_), Some(_)) => Err("'user' takes 'text' or 'content', not both".to_string()),
            (None, None) => Err("'user' needs 'text' or 'content'".to_string()),
            (Some(text), None) => {
                if text.trim().is_empty() {
                    return Err("'user' text is empty".to_string());
                }
                Ok(InputMessage::User(text))
            }
            (None, Some(parts)) => {
                check_content_parts(&parts, "user")?;
                Ok(InputMessage::UserParts(parts))
            }
        },
        InputLine::Abort => Ok(InputMessage::Abort),
        InputLine::Permission {
            request_id,
            decision,
        } => Ok(InputMessage::Permission {
            request_id,
            decision: decision.into(),
        }),
        InputLine::ToolResult {
            request_id,
            content,
            is_error,
            details,
        } => {
            // Checked before the request is touched: an over-cap answer is
            // refused as a line, and the request stays pending for a retry.
            let (content, parts) = match content {
                ToolResultContent::Text(text) => (text, None),
                ToolResultContent::Parts(parts) => {
                    check_content_parts(&parts, "tool_result")?;
                    (summarize_parts(&parts), Some(parts))
                }
            };
            Ok(InputMessage::ToolResult {
                request_id,
                result: HostToolResult {
                    content,
                    parts,
                    details: details.map(serde_json::Value::Object),
                    is_error,
                },
            })
        }
    }
}

/// Validate a client's content-part array before it is queued. `label` is the
/// input kind it arrived on (`user`, `tool_result`), for the error text.
///
/// The parts are passed through verbatim afterwards -- the shape is the model's,
/// and re-encoding it here would be a second place to get it wrong -- so this is
/// where every refusal lives: a part type that is not `text` or `image_url`, a
/// part missing the field its type requires, an image type outside
/// [`IMAGE_MIME_TYPES`](super::user_message::IMAGE_MIME_TYPES), and each cap.
pub(crate) fn check_content_parts(parts: &[serde_json::Value], label: &str) -> Result<(), String> {
    if parts.is_empty() {
        return Err(format!("'{label}' content is empty"));
    }
    let mut images = 0usize;
    let mut image_bytes = 0usize;
    let mut has_text = false;
    for part in parts {
        let kind = part
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "every content part needs a string 'type'".to_string())?;
        match kind {
            "text" => {
                let text = part
                    .get("text")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "a 'text' part needs a string 'text'".to_string())?;
                has_text |= !text.trim().is_empty();
            }
            "image_url" => {
                let url = part
                    .get("image_url")
                    .and_then(|v| v.get("url"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        "an 'image_url' part needs a string 'image_url.url'".to_string()
                    })?;
                // The decoded length, not the payload's: base64 inflates by
                // 4/3, so a payload under the cap can be an image over it.
                let (_, decoded) = super::user_message::data_url_mime_and_len(url)?;
                if decoded > MAX_IMAGE_BYTES {
                    return Err(format!(
                        "image is {decoded} bytes decoded, over the {MAX_IMAGE_BYTES} byte cap"
                    ));
                }
                images += 1;
                if images > MAX_IMAGES {
                    return Err(format!("message carries more than {MAX_IMAGES} images"));
                }
                image_bytes += decoded;
                if image_bytes > MAX_MESSAGE_IMAGE_BYTES {
                    return Err(format!(
                        "images total {image_bytes} bytes decoded, over the \
                         {MAX_MESSAGE_IMAGE_BYTES} byte cap"
                    ));
                }
            }
            other => {
                return Err(format!(
                    "unsupported content part '{other}' (text, image_url)"
                ))
            }
        }
    }
    if !has_text && images == 0 {
        return Err(format!("'{label}' content carries neither text nor an image"));
    }
    Ok(())
}

/// A rejected input line, reported on stdout. Deliberately *not* a
/// [`StreamEvent::Error`](crate::core::agent::events::StreamEvent::Error): the
/// report folds that into the run's outcome, so a typo in one line would mark
/// an otherwise successful run as failed.
#[derive(serde::Serialize, schemars::JsonSchema)]
pub(crate) struct InputErrorRecord<'a> {
    /// The record's tag. A consumer switches on it, so the schema states the
    /// value rather than leaving it an open string.
    #[serde(rename = "type")]
    #[schemars(extend("const" = "input_error"))]
    kind: &'static str,
    message: &'a str,
    /// The line that was rejected, so the client can match it to what it wrote.
    /// Truncated to [`MAX_ECHO_BYTES`], because a rejected line may be as large
    /// as [`MAX_LINE_BYTES`] and echoing it whole would hand the client back the
    /// cost the cap just removed.
    line: &'a str,
    /// True when `line` is a prefix of what the client sent, so a client that
    /// matches on the echo knows why it is short.
    line_truncated: bool,
}

impl<'a> InputErrorRecord<'a> {
    pub(crate) fn new(message: &'a str, line: &'a str) -> Self {
        let echoed = echo_prefix(line);
        Self {
            kind: "input_error",
            message,
            line: echoed,
            line_truncated: echoed.len() < line.len(),
        }
    }
}

/// The first [`MAX_ECHO_BYTES`] of `line`, cut at a character boundary.
fn echo_prefix(line: &str) -> &str {
    if line.len() <= MAX_ECHO_BYTES {
        return line;
    }
    let mut end = MAX_ECHO_BYTES;
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    &line[..end]
}

/// What the reader task and the run share: the queue the steering handshake
/// drains, and the abort latch the run selects on.
#[derive(Default)]
pub(crate) struct StreamInput {
    queued: Mutex<VecDeque<serde_json::Value>>,
    aborted: AtomicBool,
    abort: Notify,
    gone: AtomicBool,
}

impl StreamInput {
    pub(crate) fn queue_user(&self, text: String) {
        self.lock()
            .push_back(serde_json::json!({ "role": "user", "content": text }));
    }

    /// Queue a follow-up whose content is a content-part array, as the client
    /// wrote it: the `user` message the run appends is the client's own parts,
    /// not a re-encoding of them.
    pub(crate) fn queue_user_parts(&self, parts: Vec<serde_json::Value>) {
        self.lock()
            .push_back(serde_json::json!({ "role": "user", "content": parts }));
    }

    /// Hand the queue to a steering handshake. Empty is the normal answer: the
    /// loop asks at every turn boundary whether anything is waiting.
    pub(crate) fn take_queued(&self) -> Vec<serde_json::Value> {
        self.lock().drain(..).collect()
    }

    /// A std mutex is enough because nothing awaits while it is held, and it
    /// keeps `queue_user` callable from the reader without an await point.
    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<serde_json::Value>> {
        self.queued.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The reader has stopped, so nothing on stdin can answer a permission
    /// request any more. Latched rather than signalled: the question is asked
    /// once per request, at whatever point in the run it arrives.
    pub(crate) fn mark_client_gone(&self) {
        self.gone.store(true, Ordering::SeqCst);
    }

    pub(crate) fn client_gone(&self) -> bool {
        self.gone.load(Ordering::SeqCst)
    }

    pub(crate) fn abort(&self) {
        self.aborted.store(true, Ordering::SeqCst);
        self.abort.notify_waiters();
    }

    /// Resolve once the client has asked to stop. Parks forever otherwise, so
    /// it is safe as a `select!` arm for the whole run.
    pub(crate) async fn aborted(&self) {
        // The latch is checked first: an abort that arrived before this future
        // was polled has already fired its notification and would be missed.
        if self.aborted.load(Ordering::SeqCst) {
            return;
        }
        self.abort.notified().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_message_kinds_parse() {
        assert_eq!(
            parse_input_line(r#"{"type":"user","text":"also check the tests"}"#).unwrap(),
            InputMessage::User("also check the tests".to_string())
        );
        assert_eq!(
            parse_input_line(r#"{"type":"abort"}"#).unwrap(),
            InputMessage::Abort
        );
        assert_eq!(
            parse_input_line(
                r#"{"type":"permission","request_id":"perm-1","decision":"allow_once"}"#
            )
            .unwrap(),
            InputMessage::Permission {
                request_id: "perm-1".to_string(),
                decision: PermissionDecision::AllowOnce,
            }
        );
        assert_eq!(
            parse_input_line(
                r#"{"type":"tool_result","request_id":"host-1","content":"3 joints moved"}"#
            )
            .unwrap(),
            InputMessage::ToolResult {
                request_id: "host-1".to_string(),
                result: HostToolResult {
                    content: "3 joints moved".to_string(),
                    parts: None,
                    details: None,
                    is_error: false,
                },
            }
        );
    }

    /// A host tool that failed is still an answer: the model is told what went
    /// wrong and can choose another route, rather than the turn ending.
    #[test]
    fn a_failed_tool_result_is_carried_as_one() {
        assert_eq!(
            parse_input_line(
                r#"{"type":"tool_result","request_id":"host-2","content":"arm is estopped","is_error":true}"#
            )
            .unwrap(),
            InputMessage::ToolResult {
                request_id: "host-2".to_string(),
                result: HostToolResult {
                    content: "arm is estopped".to_string(),
                    parts: None,
                    details: None,
                    is_error: true,
                },
            }
        );
    }

    /// A host answers with parts the way a client sends a `user` image: the
    /// parts are carried verbatim for the model, the text summary is what
    /// text-only readers see, and `details` rides along untouched.
    #[test]
    fn a_tool_result_may_carry_parts_and_details() {
        let line = r#"{"type":"tool_result","request_id":"host-3","content":[
            {"type":"text","text":"front camera"},
            {"type":"image_url","image_url":{"url":"data:image/png;base64,QUJD"}},
            {"type":"text","text":"exposure ok"}
        ],"details":{"exposure":12,"frames":[1,2]}}"#;
        let InputMessage::ToolResult { request_id, result } = parse_input_line(line).expect(line)
        else {
            panic!("expected a tool result");
        };
        assert_eq!(request_id, "host-3");
        assert_eq!(result.content, "front camera\nexposure ok");
        let parts = result.parts.expect("parts carried");
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[1]["image_url"]["url"], "data:image/png;base64,QUJD");
        assert_eq!(
            result.details,
            Some(serde_json::json!({ "exposure": 12, "frames": [1, 2] }))
        );
        assert!(!result.is_error);
    }

    /// An image with no text still leaves hooks and the `tool_result` event
    /// something to show.
    #[test]
    fn an_image_only_tool_result_has_a_placeholder_summary() {
        let line = r#"{"type":"tool_result","request_id":"h","content":[
            {"type":"image_url","image_url":{"url":"data:image/png;base64,QUJD"}}
        ]}"#;
        let InputMessage::ToolResult { result, .. } = parse_input_line(line).expect(line) else {
            panic!("expected a tool result");
        };
        assert_eq!(result.content, IMAGE_ONLY_SUMMARY);
        assert_eq!(result.parts.map(|p| p.len()), Some(1));
        assert_eq!(result.details, None);
    }

    /// The `user` caps apply to a tool result, and the refusal names the kind
    /// it came in on so a host can tell which of its lines was wrong.
    #[test]
    fn tool_result_parts_are_held_to_the_user_caps() {
        let image = |bytes: usize| -> serde_json::Value {
            let payload = "A".repeat(bytes / 3 * 4);
            serde_json::json!({
                "type": "image_url",
                "image_url": { "url": format!("data:image/png;base64,{payload}") }
            })
        };
        let result = |content: serde_json::Value| {
            serde_json::json!({ "type": "tool_result", "request_id": "h", "content": content })
                .to_string()
        };
        let err = parse_input_line(&result(serde_json::json!([image(MAX_IMAGE_BYTES + 3)])))
            .expect_err("over the per-image cap");
        assert!(err.contains("over the 5242880 byte cap"), "{err}");
        let err = parse_input_line(&result(serde_json::json!(vec![image(3); MAX_IMAGES + 1])))
            .expect_err("over the image count");
        assert!(err.contains("more than 8 images"), "{err}");
        for (content, marker) in [
            (serde_json::json!([]), "'tool_result' content is empty"),
            (
                serde_json::json!([{ "type": "text", "text": " " }]),
                "'tool_result' content carries neither text nor an image",
            ),
            (
                serde_json::json!([{ "type": "audio" }]),
                "unsupported content part 'audio'",
            ),
            (serde_json::json!(7), "'content' to be a string or a content-part array"),
        ] {
            let err = parse_input_line(&result(content.clone())).expect_err("refused");
            assert!(err.contains(marker), "{content}: {err} lacks {marker}");
        }
        // `details` is an object or nothing: a bare value has no keys for a
        // display to render, so it is refused rather than wrapped.
        let err = parse_input_line(
            r#"{"type":"tool_result","request_id":"h","content":"x","details":5}"#,
        )
        .expect_err("details must be an object");
        assert!(err.contains("expected a map"), "{err}");
    }

    /// The advertised kinds and the accepted ones are one list. A kind the
    /// parser takes but the handshake never names is a capability no client can
    /// discover; one it names but cannot parse is a lie a client acts on. The
    /// `panic!` arm is the prompt to add a sample line when the list grows.
    #[test]
    fn the_advertised_kinds_are_the_accepted_ones() {
        let err = parse_input_line(r#"{"type":"steer","text":"hi"}"#).expect_err("unknown type");
        for kind in INPUT_KINDS {
            assert!(
                err.contains(kind),
                "the rejection does not name '{kind}': {err}"
            );
            let line = match kind {
                "user" => r#"{"type":"user","text":"hello"}"#,
                "abort" => r#"{"type":"abort"}"#,
                "permission" => r#"{"type":"permission","request_id":"p1","decision":"deny"}"#,
                "tool_result" => {
                    r#"{"type":"tool_result","request_id":"h1","content":"done"}"#
                }
                other => panic!("'{other}' is advertised but has no sample line here"),
            };
            assert!(
                parse_input_line(line).is_ok(),
                "'{kind}' is advertised in init but the parser rejects it"
            );
        }
    }

    /// Every rejection names what was wrong: the client sees this text on the
    /// stream and has nothing else to debug against.
    #[test]
    fn malformed_lines_are_rejected_with_a_reason() {
        for (line, marker) in [
            ("not json at all", "not JSON"),
            (r#"{"text":"hi"}"#, "missing string field 'type'"),
            (r#"{"type":"steer","text":"hi"}"#, "unknown type 'steer'"),
            (r#"{"type":"user"}"#, "'user' needs 'text' or 'content'"),
            (
                r#"{"type":"user","text":"a","content":[{"type":"text","text":"b"}]}"#,
                "'user' takes 'text' or 'content', not both",
            ),
            (r#"{"type":"user","text":"  "}"#, "is empty"),
            (r#"{"type":"user","content":[]}"#, "content is empty"),
            (
                r#"{"type":"user","content":[{"type":"audio","audio":{"url":"x"}}]}"#,
                "unsupported content part 'audio'",
            ),
            (
                r#"{"type":"user","content":[{"type":"text"}]}"#,
                "a 'text' part needs a string 'text'",
            ),
            (
                r#"{"type":"user","content":[{"type":"image_url","image_url":{}}]}"#,
                "needs a string 'image_url.url'",
            ),
            (
                r#"{"type":"user","content":[{"type":"image_url","image_url":{"url":"/tmp/a.png"}}]}"#,
                "must be a data: URL",
            ),
            (
                r#"{"type":"user","content":[{"type":"image_url","image_url":{"url":"data:image/svg+xml;base64,QUJD"}}]}"#,
                "unsupported image type",
            ),
            (
                r#"{"type":"user","content":[{"type":"text","text":"  "}]}"#,
                "carries neither text nor an image",
            ),
            (r#"{"type":"permission","decision":"deny"}"#, "missing field `request_id`"),
            (r#"{"type":"permission","request_id":"p"}"#, "missing field `decision`"),
            (
                r#"{"type":"permission","request_id":"p","decision":"maybe"}"#,
                "unknown variant `maybe`, expected one of `allow_once`, `allow_always`, `deny`",
            ),
            (
                r#"{"type":"tool_result","content":"x"}"#,
                "missing field `request_id`",
            ),
            (
                r#"{"type":"tool_result","request_id":"h1"}"#,
                "missing field `content`",
            ),
            (
                r#"{"type":"tool_result","request_id":"h1","content":"x","is_error":"yes"}"#,
                "invalid type: string \"yes\", expected a boolean",
            ),
        ] {
            let err = parse_input_line(line).expect_err(line);
            assert!(err.contains(marker), "{line}: {err} lacks {marker}");
        }
    }

    /// A line carrying an image with no text at all is a message, not a typo:
    /// the model reads the image and nothing else.
    #[test]
    fn an_image_only_message_is_accepted() {
        let line = r#"{"type":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJD"}}]}"#;
        let message = parse_input_line(line).expect("an image-only message");
        let InputMessage::UserParts(parts) = message else {
            panic!("expected parts, got {message:?}");
        };
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "image_url");
    }

    /// A content-part message is accepted and carried as written: the parts the
    /// client sent are the parts that reach the request, extensions included.
    #[test]
    fn content_parts_are_carried_as_written() {
        let line = r#"{"type":"user","content":[
            {"type":"text","text":"what changed here?","cache_control":{"type":"ephemeral"}},
            {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,QUJD","detail":"high"}}
        ]}"#;
        let InputMessage::UserParts(parts) = parse_input_line(line).expect(line) else {
            panic!("expected parts");
        };
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0]["cache_control"]["type"], "ephemeral");
        assert_eq!(parts[1]["image_url"]["detail"], "high");
        assert_eq!(parts[1]["image_url"]["url"], "data:image/jpeg;base64,QUJD");
    }

    /// Each cap is enforced on the decoded size, the count, and the total, and
    /// the refusal names the cap it crossed.
    #[test]
    fn the_content_caps_are_enforced() {
        let image = |bytes: usize| -> serde_json::Value {
            let payload = "A".repeat(bytes / 3 * 4);
            serde_json::json!({
                "type": "image_url",
                "image_url": { "url": format!("data:image/png;base64,{payload}") }
            })
        };
        let message = |parts: Vec<serde_json::Value>| {
            serde_json::json!({ "type": "user", "content": parts }).to_string()
        };

        let over_one = parse_input_line(&message(vec![image(MAX_IMAGE_BYTES + 3)]))
            .expect_err("over the per-image cap");
        assert!(over_one.contains("over the 5242880 byte cap"), "{over_one}");

        let at_one = message(vec![image(MAX_IMAGE_BYTES)]);
        assert!(
            parse_input_line(&at_one).is_ok(),
            "exactly at the cap is inside it"
        );

        let too_many = message(vec![image(3); MAX_IMAGES + 1]);
        let err = parse_input_line(&too_many).expect_err("over the image count");
        assert!(err.contains("more than 8 images"), "{err}");

        let over_total = message(vec![image(MAX_IMAGE_BYTES); 3]);
        let err = parse_input_line(&over_total).expect_err("over the message total");
        assert!(err.contains("over the 10485760 byte cap"), "{err}");
    }

    /// The echo in a rejection is bounded: the client sent a line whose size
    /// was already refused, and handing it all back would move the cost the cap
    /// removed from the parser onto the client's reader.
    #[test]
    fn a_rejected_line_is_echoed_truncated() {
        let line = "y".repeat(MAX_ECHO_BYTES + 1);
        let record = serde_json::to_value(InputErrorRecord::new("nope", &line)).expect("record");
        assert_eq!(record["line"].as_str().map(str::len), Some(MAX_ECHO_BYTES));
        assert_eq!(record["line_truncated"], serde_json::json!(true));

        let short = serde_json::to_value(InputErrorRecord::new("nope", "bad")).expect("record");
        assert_eq!(short["line"], serde_json::json!("bad"));
        assert_eq!(short["line_truncated"], serde_json::json!(false));
    }

    /// Truncation cuts on a character boundary: the echo is text a client
    /// prints, and half a code point would be a decoding error there.
    #[test]
    fn the_echo_cuts_on_a_character_boundary() {
        let line = "é".repeat(MAX_ECHO_BYTES);
        let record = serde_json::to_value(InputErrorRecord::new("nope", &line)).expect("record");
        let echoed = record["line"].as_str().expect("a string");
        assert!(echoed.len() <= MAX_ECHO_BYTES);
        assert!(line.starts_with(echoed));
    }

    #[test]
    fn queued_turns_drain_once_and_in_order() {
        let input = StreamInput::default();
        assert!(input.take_queued().is_empty());
        input.queue_user("first".to_string());
        input.queue_user("second".to_string());
        let drained = input.take_queued();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0]["role"], "user");
        assert_eq!(drained[0]["content"], "first");
        assert_eq!(drained[1]["content"], "second");
        assert!(input.take_queued().is_empty());
    }

    /// A parts turn queues beside a text turn as the same kind of message: same
    /// role, same position, content as an array instead of a string.
    #[test]
    fn a_parts_turn_queues_as_the_same_message_kind() {
        let input = StreamInput::default();
        let parts = vec![serde_json::json!({ "type": "text", "text": "hi" })];
        input.queue_user_parts(parts.clone());
        let drained = input.take_queued();
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0]["role"], "user");
        assert_eq!(drained[0]["content"], serde_json::json!(parts));
    }

    /// The latch, not just the notification: an abort landing before the run
    /// parks on it must still be seen, or the client's stop is swallowed.
    #[tokio::test]
    async fn an_abort_that_arrives_early_is_still_observed() {
        let input = StreamInput::default();
        input.abort();
        input.aborted().await;
    }
}
