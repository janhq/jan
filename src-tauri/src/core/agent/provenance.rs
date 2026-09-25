//! Request provenance: what a run is about to send a provider, and nothing else.
//!
//! The record is identity, not content -- a hash of the body, a hash of the tool
//! array, and one hash per image -- so an experiment harness can hold two runs
//! comparable without copying prompts or frames around. It is emitted
//! immediately before each request goes out, for the main run and for every
//! child, which is the shape Robot Studio already records from pi's
//! `onPayload`.
//!
//! The hashes describe the body Jan built for the adapter: canonical JSON, every
//! object's keys sorted recursively, so two bodies carrying the same members in
//! a different order hash alike. They are therefore stable for a given run and
//! comparable across runs of the same provider.
//!
//! What is hashed is the body *before* the adapter adds its own transport
//! fields (`stream`, `stream_options`), so it is not byte-for-byte what the
//! provider received: a harness that re-sorts the body it saw and drops those
//! two fields arrives at the same digest, which is what "recomputable" means
//! here. Two runs on different wire APIs differ by construction: the tool array
//! each provider receives is not the same shape.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::core::agent::events::{ProvenanceImage, StreamEvent};

/// Who is sending the request: the same identity the request's own correlation
/// id and a child's `run_id` carry.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct RequestIdentity<'a> {
    /// `None` for the main run, the child's run id for a subagent.
    pub run_id: Option<&'a str>,
    /// The session the request belongs to, when the run has one.
    pub session_id: Option<&'a str>,
    /// The configured provider the model resolved to.
    pub provider: Option<&'a str>,
    /// The wire API the body is built for, absent for chat/completions.
    pub api_type: Option<&'a str>,
}

/// The [`StreamEvent::RequestProvenance`] for one outbound request body.
pub(crate) fn of_request(body: &Value, identity: RequestIdentity<'_>) -> StreamEvent {
    let bytes = canonical_bytes(body);
    StreamEvent::RequestProvenance {
        run_id: identity.run_id.map(str::to_string),
        session_id: identity.session_id.map(str::to_string),
        provider: identity.provider.map(str::to_string),
        model: body
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or_default()
            .to_string(),
        api_type: identity.api_type.map(str::to_string),
        request_sha256: sha256_hex(&bytes),
        body_bytes: bytes.len() as u64,
        tools_sha256: body
            .get("tools")
            .filter(|tools| tools.as_array().is_some_and(|t| !t.is_empty()))
            .map(|tools| sha256_hex(&canonical_bytes(tools))),
        images: images_of(body),
    }
}

/// Every image the body carries, in message order.
///
/// A `data:` URL is hashed over its decoded bytes, so a host can hash the frame
/// it captured and compare; a remote URL is hashed as text (there are no bytes
/// here to hash, the provider fetches them), which is why it reports no MIME
/// type and zero bytes.
fn images_of(body: &Value) -> Vec<ProvenanceImage> {
    let mut images = Vec::new();
    let Some(messages) = body.get("messages").and_then(|m| m.as_array()) else {
        return images;
    };
    for message in messages {
        let tool_call_id = message
            .get("tool_call_id")
            .and_then(|id| id.as_str())
            .map(str::to_string);
        let Some(parts) = message.get("content").and_then(|c| c.as_array()) else {
            continue;
        };
        for url in parts
            .iter()
            .filter(|part| part.get("type").and_then(|t| t.as_str()) == Some("image_url"))
            .filter_map(|part| part.get("image_url")?.get("url")?.as_str())
        {
            if let Some((mime_type, payload)) = data_url_parts(url) {
                if let Ok(decoded) = BASE64.decode(payload) {
                    images.push(ProvenanceImage {
                        sha256: sha256_hex(&decoded),
                        mime_type: mime_type.to_string(),
                        bytes: decoded.len() as u64,
                        tool_call_id: tool_call_id.clone(),
                    });
                }
            } else if url.starts_with("http://") || url.starts_with("https://") {
                images.push(ProvenanceImage {
                    sha256: sha256_hex(url.as_bytes()),
                    mime_type: String::new(),
                    bytes: 0,
                    tool_call_id: tool_call_id.clone(),
                });
            }
        }
    }
    images
}

/// `("image/png", "<base64>")` for a `data:image/png;base64,<payload>` URL.
fn data_url_parts(url: &str) -> Option<(&str, &str)> {
    let rest = url.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let (mime, encoding) = meta.split_once(';')?;
    if !encoding.eq_ignore_ascii_case("base64") || payload.is_empty() {
        return None;
    }
    Some((mime, payload))
}

/// `value` as canonical JSON: every object's keys sorted, recursively.
///
/// The digest has to be one value per body, not one per key order: a body this
/// process assembles and a harness's re-encoding of the same members have to
/// agree. Sorting is the whole of the normalization -- numbers and strings are
/// carried as serde_json writes them, which is deterministic for a value built
/// once here.
pub(crate) fn canonical_bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(&sorted(value)).unwrap_or_default()
}

fn sorted(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key.clone(), sorted(value)))
                    .collect(),
            )
        }
        other => other.clone(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(body: &Value) -> (String, u64, Option<String>, Vec<ProvenanceImage>) {
        match of_request(body, RequestIdentity::default()) {
            StreamEvent::RequestProvenance {
                request_sha256,
                body_bytes,
                tools_sha256,
                images,
                ..
            } => (request_sha256, body_bytes, tools_sha256, images),
            other => panic!("expected a provenance record, got {other:?}"),
        }
    }

    #[test]
    fn the_body_hash_is_stable_for_the_same_request() {
        let body = json!({"model": "m", "messages": [{"role": "user", "content": "hi"}]});
        let (first, bytes, tools, _) = record(&body);
        let (second, ..) = record(&body);
        assert_eq!(first, second);
        assert_eq!(bytes as usize, canonical_bytes(&body).len());
        assert!(tools.is_none(), "no tools array means no tools hash");

        let changed = json!({"model": "m", "messages": [{"role": "user", "content": "hello"}]});
        assert_ne!(record(&changed).0, first, "a changed body changes the hash");
    }

    #[test]
    fn a_different_key_order_is_the_same_request() {
        // The same members, assembled in another order -- nested, and in the
        // tools array too. A harness re-encoding the body it saw must land on
        // the digest this process reported.
        let assembled = json!({
            "model": "m",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{"type": "function", "function": {"name": "read", "parameters": {"type": "object"}}}],
        });
        let re_encoded = json!({
            "tools": [{"function": {"parameters": {"type": "object"}, "name": "read"}, "type": "function"}],
            "messages": [{"content": "hi", "role": "user"}],
            "model": "m",
        });

        let (hash, bytes, tools, _) = record(&assembled);
        let (other_hash, other_bytes, other_tools, _) = record(&re_encoded);
        assert_eq!(hash, other_hash, "key order is not part of the identity");
        assert_eq!(bytes, other_bytes, "and neither is the serialized length");
        assert_eq!(tools, other_tools);
    }

    #[test]
    fn images_are_hashed_over_their_decoded_bytes() {
        // "QUJD" is "ABC": 3 bytes, so the hash is over those three bytes.
        let body = json!({
            "model": "m",
            "messages": [
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "call_7", "type": "function", "function": {"name": "camera", "arguments": "{}"}}
                ]},
                {"role": "tool", "tool_call_id": "call_7", "content": [
                    {"type": "text", "text": "front camera"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD"}}
                ]},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,QQ=="}},
                    {"type": "image_url", "image_url": {"url": "https://example.test/shot.png"}}
                ]}
            ]
        });
        let images = record(&body).3;
        assert_eq!(images.len(), 3);
        assert_eq!(
            images[0],
            ProvenanceImage {
                sha256: sha256_hex(b"ABC"),
                mime_type: "image/png".into(),
                bytes: 3,
                tool_call_id: Some("call_7".into()),
            }
        );
        assert_eq!(images[1].bytes, 1);
        assert_eq!(images[1].mime_type, "image/jpeg");
        assert_eq!(images[1].tool_call_id, None, "a user image names no call");
        assert_eq!(images[2].bytes, 0, "a remote URL has no bytes here");
        assert_eq!(images[2].mime_type, "");
        assert_eq!(
            images[2].sha256,
            sha256_hex(b"https://example.test/shot.png")
        );
    }

    #[test]
    fn the_tools_hash_tracks_the_schemas_sent() {
        let tools = json!([{"type": "function", "function": {"name": "read", "parameters": {"type": "object"}}}]);
        let body = json!({"model": "m", "messages": [], "tools": tools});
        let hash = record(&body).2.expect("tools hash");
        assert_eq!(
            hash,
            sha256_hex(&canonical_bytes(&tools)),
            "the hash is over the array as sent, canonical"
        );
        assert_eq!(
            record(&json!({"model": "m", "messages": [], "tools": []})).2,
            None,
            "an empty tools array is not a schema"
        );
    }

    #[test]
    fn identity_and_model_travel_into_the_record() {
        let body = json!({"model": "claude-sonnet-5", "messages": []});
        let event = of_request(
            &body,
            RequestIdentity {
                run_id: Some("child-1"),
                session_id: Some("session-9"),
                provider: Some("anthropic"),
                api_type: Some("anthropic"),
            },
        );
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["type"], "request_provenance");
        assert_eq!(value["run_id"], "child-1");
        assert_eq!(value["session_id"], "session-9");
        assert_eq!(value["provider"], "anthropic");
        assert_eq!(value["api_type"], "anthropic");
        assert_eq!(value["model"], "claude-sonnet-5");
        assert!(value.get("images").is_none(), "no images, no field");

        // And a record with every optional field absent still reads back: a
        // consumer validates what it receives against these shapes.
        let minimal = of_request(&body, RequestIdentity::default());
        let line = serde_json::to_string(&minimal).unwrap();
        let back: StreamEvent = serde_json::from_str(&line).expect("reads back without optionals");
        assert_eq!(
            serde_json::to_value(&back).unwrap(),
            serde_json::to_value(&minimal).unwrap()
        );
    }
}
