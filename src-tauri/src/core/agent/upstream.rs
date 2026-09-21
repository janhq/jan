//! Upstream/provider plumbing shared by the API-server proxy and the agent loop:
//! message normalization, model->upstream resolution, OpenAI chat-completion
//! calls, and MCP tool collection/execution. Lifted verbatim from
//! `core/server/proxy.rs` (no behavior change) so both the server path and
//! `core/agent/loop.rs` consume one implementation.

use futures_util::StreamExt;
#[cfg(feature = "cli")]
use std::cmp::Reverse;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use reqwest::Client;
use rmcp::model::{CallToolRequestParams, CallToolResult};
#[cfg(not(feature = "cli"))]
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, Mutex};

use crate::core::agent::events::StreamEvent;
use crate::core::openai_schema::normalize_openai_tool_parameters_schema;
use crate::core::server::converters::UpstreamConverter;
#[cfg(not(feature = "cli"))]
use crate::core::server::proxy::engine_upstream;
#[cfg(not(feature = "cli"))]
use crate::core::server::MlxBackendSession;
use crate::core::{
    mcp::models::McpSettings,
    mcp::truncate::truncate_tool_result,
    state::{ProviderConfig, SharedMcpServers},
};

fn assistant_json_path(jan_data_folder: &str, assistant_id: &str) -> PathBuf {
    PathBuf::from(jan_data_folder)
        .join("assistants")
        .join(assistant_id)
        .join("assistant.json")
}

pub(crate) fn load_assistant_config(
    jan_data_folder: &str,
    assistant_id: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let assistant_path = assistant_json_path(jan_data_folder, assistant_id);
    let raw = fs::read_to_string(&assistant_path)
        .map_err(|e| format!("Failed to read assistant.json: {assistant_path:?}: {e}"))?;

    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid assistant.json ({assistant_id}): {e}"))?;

    let instructions = parsed
        .get("instructions")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let model = parsed
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok((instructions, model))
}

pub(crate) fn parse_openai_messages(
    messages: &serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
    let arr = messages
        .as_array()
        .ok_or("Request body must include 'messages' as an array")?;

    let mut out = Vec::with_capacity(arr.len());
    for msg in arr {
        let role = msg
            .get("role")
            .and_then(|v| v.as_str())
            .ok_or("Each message must include a string 'role'")?;

        // Assistant tool-call turns carry `tool_calls` and may have `content: null`
        // (or omit it entirely) per the OpenAI protocol. `tool` result messages
        // carry a `tool_call_id`. These shapes flow back into the conversation
        // history (see MessagesUpdated), so a follow-up request re-submits them and
        // must preserve them verbatim -- otherwise the assistant/tool pairing is
        // broken and content-null turns are wrongly rejected.
        let has_tool_calls = msg
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty());
        let tool_call_id = msg.get("tool_call_id").and_then(|v| v.as_str());

        // Content is a plain string or an OpenAI multimodal content-part array
        // (text + image_url); pass either through verbatim. It may be null (or
        // absent) only when the assistant message carries tool_calls.
        let content = match msg.get("content") {
            Some(v @ serde_json::Value::String(_)) | Some(v @ serde_json::Value::Array(_)) => {
                v.clone()
            }
            // Null/absent content is valid for an assistant turn whose payload is
            // entirely tool calls; normalize to null so upstream sees a well-formed
            // message.
            Some(serde_json::Value::Null) | None if has_tool_calls || tool_call_id.is_some() => {
                serde_json::Value::Null
            }
            _ => return Err("Each message must include 'content' as a string or array".into()),
        };

        let mut obj = serde_json::Map::new();
        obj.insert("role".to_string(), serde_json::json!(role));
        obj.insert("content".to_string(), content);
        // Preserve a resent assistant turn's reasoning alongside its content and
        // tool calls. Some providers require prior reasoning to be resubmitted
        // to keep a (local llama.cpp `preserve_thinking`) chat template honest:
        // dropping it would shrink earlier assistant turns and force reprocessing
        // of the KV-cache prefix. Only assistant messages carry it; user/tool/
        // system passes are untouched by construction.
        if role == "assistant" {
            if let Some(r) = msg.get("reasoning_content").and_then(|v| v.as_str()) {
                if !r.is_empty() {
                    obj.insert("reasoning_content".to_string(), serde_json::json!(r));
                }
            }
        }
        if has_tool_calls {
            obj.insert("tool_calls".to_string(), msg["tool_calls"].clone());
        }
        if let Some(id) = tool_call_id {
            obj.insert("tool_call_id".to_string(), serde_json::json!(id));
        }
        out.push(serde_json::Value::Object(obj));
    }
    Ok(out)
}

/// Repairs a "dangling" tool-call turn: an assistant message with
/// `tool_calls` whose ids don't all have a matching `role: "tool"` reply
/// immediately after. Anthropic (and some other providers) reject the whole
/// request outright when this happens, rather than just the offending turn.
///
/// This can happen if a previous run was interrupted before a tool result was
/// ever recorded -- e.g. the process crashed or was force-killed while an
/// `ask`/permission prompt was still pending -- and the incomplete turn was
/// then persisted and later resumed/replayed. Insert a synthetic error result
/// for each missing id so the conversation is always well-formed by the time
/// it leaves this process, regardless of how the gap was introduced. Returns
/// the number of ids repaired.
pub(crate) fn repair_dangling_tool_calls(messages: &mut Vec<serde_json::Value>) -> usize {
    let mut repaired = 0;
    let mut i = 0;
    while i < messages.len() {
        let ids: Vec<String> = messages[i]
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .map(|calls| {
                calls
                    .iter()
                    .filter_map(|tc| tc.get("id").and_then(|v| v.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        if ids.is_empty() {
            i += 1;
            continue;
        }
        // A tool-call turn's replies are the run of `role: "tool"` messages
        // immediately following it; the run ends at the next message that
        // isn't a tool reply.
        let mut answered: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut j = i + 1;
        while j < messages.len() && messages[j].get("role").and_then(|v| v.as_str()) == Some("tool")
        {
            if let Some(id) = messages[j].get("tool_call_id").and_then(|v| v.as_str()) {
                answered.insert(id);
            }
            j += 1;
        }
        let missing: Vec<&String> = ids
            .iter()
            .filter(|id| !answered.contains(id.as_str()))
            .collect();
        for id in &missing {
            messages.insert(
                j,
                serde_json::json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": "ERROR: this tool call was interrupted before it produced a \
                        result (e.g. an unanswered question or a cancelled run); treat it as \
                        failed.",
                }),
            );
            j += 1;
        }
        repaired += missing.len();
        i = j;
    }
    repaired
}

/// Drops `role: "tool"` messages whose `tool_call_id` matches no tool call in
/// the same array.
///
/// [`drop_malformed_tool_calls`] removes the results of the calls it refuses,
/// but nothing else in this module looks at a result whose call was never
/// there: a caller's stored thread can carry a tool reply left behind by a
/// dropped call, or one whose call lost its id, and a strict upstream rejects
/// the entire request over that single orphan (Anthropic is the loudest, but
/// OpenAI-compatible routes reject it too). This is the mirror of
/// [`repair_dangling_tool_calls`] -- that pass fills a call that lost its
/// result, this one removes a result that lost its call -- and the two together
/// are what make the adoption boundary's history wire-shaped. Returns the
/// number of results dropped.
pub(crate) fn drop_orphaned_tool_results(messages: &mut Vec<serde_json::Value>) -> usize {
    let mut called: std::collections::HashSet<String> = std::collections::HashSet::new();
    for message in messages.iter() {
        let Some(calls) = message.get("tool_calls").and_then(|v| v.as_array()) else {
            continue;
        };
        for call in calls {
            if let Some(id) = pairable_tool_call_id(call) {
                called.insert(id.to_string());
            }
        }
    }
    let before = messages.len();
    messages.retain(|message| {
        if message.get("role").and_then(|v| v.as_str()) != Some("tool") {
            return true;
        }
        message
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .is_some_and(|id| !id.is_empty() && called.contains(id))
    });
    before - messages.len()
}

/// The id a tool call's result has to answer with, or `None` when the call
/// cannot be paired at all.
///
/// The result of a call is a `role: "tool"` message carrying the call's id, and
/// a strict upstream rejects a request where the two do not line up. A call
/// whose `id` is missing, not a string, or empty has nothing for its result to
/// carry, so it is neither executed nor recorded -- see
/// [`drop_malformed_tool_calls`] for the history side of the same rule.
pub(crate) fn pairable_tool_call_id(call: &serde_json::Value) -> Option<&str> {
    call.get("id")
        .and_then(|id| id.as_str())
        .filter(|id| !id.is_empty())
}

/// A call the record may hold: its result can be paired with it, and its
/// arguments are a plain JSON object.
pub(crate) fn tool_call_is_usable(call: &serde_json::Value) -> bool {
    pairable_tool_call_id(call).is_some() && arguments_are_executable(call)
}

/// Whether a tool call's arguments are safe to execute and to keep in
/// provider-visible history.
///
/// The invariant: what the provider sees as `arguments` must decode to a
/// plain JSON object. The OpenAI wire shape is a JSON-encoded string, so a
/// string decoding to an object is the normal case. A string decoding to
/// another string, number, boolean, null, or array is the poisoned shape a
/// truncated or confused model emits: it parses cleanly, so a parse-only
/// check calls it safe, and the upstream rejects the whole request over it
/// ("arguments must be a JSON object"). Absent, null, and empty arguments
/// are the "no arguments" spelling.
pub(crate) fn arguments_are_executable(tc: &serde_json::Value) -> bool {
    let Some(args) = tc.get("function").and_then(|f| f.get("arguments")) else {
        return true;
    };
    let Some(args) = args.as_str() else {
        // Off-wire shapes: an object is equivalent to valid arguments; a
        // list or scalar is poison; null means "no arguments".
        return matches!(args, serde_json::Value::Object(_) | serde_json::Value::Null);
    };
    let args = args.trim();
    if args.is_empty() {
        return true;
    }
    matches!(
        serde_json::from_str::<serde_json::Value>(args),
        Ok(v) if v.is_object()
    )
}

/// Drops "poisoned" tool calls: an assistant `tool_calls` entry whose
/// `function.arguments` is not parsable JSON, or which has no non-empty id for
/// its result to carry. A model (observed with DeepSeek/vLLM) can end a stream
/// mid-argument while still reporting `finish_reason: "tool_calls"`, so the
/// truncated call is persisted into the thread. Every later turn resends it,
/// and an OpenAI-compatible upstream rejects the whole request with 422 -- the
/// session is wedged, because the poison is in the history the agent keeps
/// replaying.
///
/// Removal, not reconstruction: a truncated argument cannot be recovered, and
/// inventing one would run a tool the model never actually asked for. The call
/// is dropped along with any `role: "tool"` reply carrying its `tool_call_id` -
/// including the empty id an unpaired result carries - so no orphaned result is
/// left behind. Valid sibling calls in the same turn survive; an assistant turn
/// whose calls are ALL dropped keeps its text and loses only the `tool_calls`
/// key (and is removed entirely if that leaves it empty, which would otherwise
/// be a contentless assistant turn some providers reject). Returns the number
/// of calls dropped.
///
/// Runs before [`drop_orphaned_tool_results`] and
/// [`repair_dangling_tool_calls`], so a surviving call that lost its result
/// still gets the synthetic error reply from that pass.
pub(crate) fn drop_malformed_tool_calls(messages: &mut Vec<serde_json::Value>) -> usize {
    // A call is refused when the record could not hold it: an unparsable
    // `arguments` is the truncated-stream shape, and an absent or empty `id` is
    // one nothing can pair a result with. An absent or empty `arguments` is the
    // well-formed "no arguments" spelling several providers use, and is left
    // alone.
    let mut dropped_ids: Vec<String> = Vec::new();
    for msg in messages.iter_mut() {
        dropped_ids.extend(prune_unusable_tool_calls(msg));
    }
    if dropped_ids.is_empty() {
        return 0;
    }
    // Drop the results that answered a dropped call, then any assistant turn
    // left with neither text nor calls (content-null with no tool_calls is not
    // a valid turn to resend).
    messages.retain(|m| {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or_default();
        if role == "tool" {
            let id = m
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            return !dropped_ids.iter().any(|d| d == id);
        }
        if role != "assistant" || m.get("tool_calls").is_some() {
            return true;
        }
        // Keep a turn that still says something; a content-null/empty one is
        // now an empty shell left by the dropped call.
        !content_says_nothing(m)
    });
    dropped_ids.len()
}

/// Refuse the tool calls in `message` the wire cannot carry, naming each.
///
/// This is the per-message half of [`drop_malformed_tool_calls`], and the same
/// rule the live record applies as it accepts an assistant turn (see
/// `loop::record_assistant_turn`): a call is refused when its result could not
/// be paired with it, which is why a refused call with no id is still named
/// here - its result carries the empty id, and skipping it would leave the
/// orphan this pass exists to prevent. The `tool_calls` key is removed when
/// every call went, and left untouched when none did, so a message with
/// nothing to refuse is not rewritten. Returns the refused ids, empty id
/// included, or an empty list when the message has no calls to refuse.
pub(crate) fn prune_unusable_tool_calls(message: &mut serde_json::Value) -> Vec<String> {
    let Some(calls) = message.get("tool_calls").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    if calls.iter().all(tool_call_is_usable) {
        return Vec::new();
    }
    let mut kept: Vec<serde_json::Value> = Vec::with_capacity(calls.len());
    let mut refused: Vec<String> = Vec::new();
    for call in calls {
        if tool_call_is_usable(call) {
            kept.push(call.clone());
        } else {
            refused.push(pairable_tool_call_id(call).unwrap_or_default().to_string());
        }
    }
    if let Some(obj) = message.as_object_mut() {
        if kept.is_empty() {
            obj.remove("tool_calls");
        } else {
            obj.insert("tool_calls".to_string(), serde_json::Value::Array(kept));
        }
    }
    refused
}

/// Whether a message's content carries nothing: no text, or text that is only
/// whitespace, or an empty parts array. An absent or null content says nothing,
/// which is what makes an assistant turn that lost its calls an empty shell
/// rather than a message worth resending.
pub(crate) fn content_says_nothing(message: &serde_json::Value) -> bool {
    match message.get("content") {
        Some(serde_json::Value::String(text)) => text.trim().is_empty(),
        Some(serde_json::Value::Array(parts)) => parts.is_empty(),
        _ => true,
    }
}

fn system_node(content: &str) -> serde_json::Value {
    serde_json::json!({ "role": "system", "content": content })
}

pub(crate) fn is_system_node(message: &serde_json::Value) -> bool {
    message.get("role").and_then(|r| r.as_str()) == Some("system")
}

fn system_text(message: &serde_json::Value) -> Option<&str> {
    message.get("content").and_then(|c| c.as_str())
}

/// A node this module wrote to carry per-turn context rather than history: a
/// `system` message that is not a compaction summary.
fn is_volatile_node(message: &serde_json::Value) -> bool {
    is_system_node(message) && !crate::core::agent::compaction::is_compaction_summary(message)
}

/// Where the per-turn volatile block belongs: index 1 once a stable prompt
/// holds index 0, else index 0. One slot, because the stable prompt is only
/// ever placed at index 0 or appended behind it - so this is the single
/// position a per-turn block can be rewritten in without disturbing the bytes
/// an earlier request already sent as its head.
fn volatile_slot(messages: &[serde_json::Value]) -> usize {
    usize::from(messages.first().is_some_and(is_system_node))
}

/// Index of the stable prompt node the next request would extend: the last
/// `system` node this module owns, i.e. neither the volatile slot nor a
/// compaction summary (condensed history that happens to carry the same role).
///
/// The layout is `[stable, volatile, ..history..]`, so before any update this
/// resolves to index 0; after one it resolves to the node appended at the tail.
/// That is what makes a repeated turn a no-op instead of a second append, and
/// what keeps an update from being mistaken for the volatile block and vice
/// versa.
fn live_stable_index(messages: &[serde_json::Value]) -> Option<usize> {
    let slot = volatile_slot(messages);
    messages
        .iter()
        .enumerate()
        .rev()
        .find(|(index, message)| is_volatile_node(message) && *index != slot)
        .map(|(index, _)| index)
}

/// Apply the session's stable system prompt, append-only.
///
/// The head of a request is the region a provider can reuse, and it only reuses
/// bytes that are identical to the previous request. Rewriting message 0 - one
/// word of assistant instructions, a skill installed mid-session, an edited
/// project config, a mode switch - invalidated everything behind it, tool
/// schemas included, on every turn it happened. A prompt that changed is
/// therefore appended as a new `system` node at the tail instead: the request
/// keeps the bytes it already sent, and the update lands where the cached
/// prefix is still intact.
///
/// An appended node is not ignored: a request's system nodes are concatenated in
/// array order (`genai_bridge::messages_from_body`) and dispatched as one system
/// instruction per provider, so the newest prompt is the last thing the model
/// reads rather than a duplicate of an earlier one.
///
/// The invariants this keeps, which the tests assert directly:
/// - an unchanged prompt mutates nothing at all;
/// - a changed prompt leaves every index it does not append to byte-identical;
/// - index 0 is written once and never rewritten;
/// - nothing is deleted by role, so history a producer stored under `system`
///   (a compaction summary) survives a rebuild.
pub(crate) fn set_system_prompt(messages: &mut Vec<serde_json::Value>, system_prompt: &str) {
    match live_stable_index(messages) {
        // Already the live prompt: zero mutations, so a turn that changed
        // nothing cannot invalidate its own prefix.
        Some(index) if system_text(&messages[index]) == Some(system_prompt) => {}
        // A conversation that has been sent before: append the update.
        Some(_) => messages.push(system_node(system_prompt)),
        // No system node at all (a fresh conversation, or history loaded
        // without a prompt): the prompt is the head, so it is written there.
        None => messages.insert(0, system_node(system_prompt)),
    }
}

/// Replace the conversation's system prompt in place, for the API server's
/// proxy path.
///
/// That path is stateless and authoritative: it parses a caller-supplied
/// conversation and applies the assistant's configured prompt to it, so the
/// caller's own `system` message is what is being replaced. There is no
/// conversation to keep byte-stable across turns - the caller sends a fresh
/// body each request - so this keeps the older replace-at-head semantics rather
/// than appending a second prompt behind the caller's.
///
/// Desktop-only, like the proxy that is its only caller.
#[cfg(not(feature = "cli"))]
pub(crate) fn replace_system_prompt(messages: &mut Vec<serde_json::Value>, system_prompt: &str) {
    // Drop the previous prompt, but keep compaction summaries: they are
    // `system` messages, yet they carry condensed history that this turn must
    // not throw away.
    messages.retain(|m| {
        !is_system_node(m) || crate::core::agent::compaction::is_compaction_summary(m)
    });
    messages.insert(0, system_node(system_prompt));
}

/// Place the per-turn context block (today's date, query-specific memory
/// recall, plan/todo state) in the conversation's volatile slot, leaving the
/// stable prompt ahead of it untouched.
///
/// The block is the same on every turn between its own changes, so the slot is
/// rewritten only when the content differs. That matters for the same reason
/// the stable prompt is append-only: rewriting it ends the reusable prefix
/// there, so a turn that changed nothing but the conversation's tail must not
/// rewrite it either.
///
/// Assumes `set_system_prompt` has already placed the stable prompt.
pub(crate) fn insert_volatile_system(messages: &mut Vec<serde_json::Value>, content: &str) {
    let slot = volatile_slot(messages);
    match messages.get(slot) {
        // This turn's block is already in place: leave every byte alone.
        Some(existing) if is_volatile_node(existing) && system_text(existing) == Some(content) => {}
        // A block from an earlier turn (or a caller's own second system
        // message) holds the slot. It is per-turn content, so it is replaced
        // rather than accumulated; a summary that landed here is not, which is
        // why the guard above asks for a volatile node.
        Some(existing) if is_volatile_node(existing) => messages[slot] = system_node(content),
        _ => messages.insert(slot, system_node(content)),
    }
}

pub(crate) fn extract_tool_calls(response: &serde_json::Value) -> Vec<serde_json::Value> {
    response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("tool_calls"))
        .and_then(|tc| tc.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default()
}

pub(crate) fn extract_choice_message(response: &serde_json::Value) -> Option<&serde_json::Value> {
    response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
}

fn mcp_call_result_to_string(result: &CallToolResult) -> String {
    let parts: Vec<String> = result
        .content
        .iter()
        .filter_map(|c| c.as_text())
        .map(|t| t.text.clone())
        .collect();

    if result.is_error == Some(true) {
        if parts.is_empty() {
            "ERROR".to_string()
        } else {
            format!("ERROR: {}", parts.join("\n"))
        }
    } else {
        parts.join("\n")
    }
}

/// True when the provider carries a credential (an API key or key chain),
/// so a model id offered by several providers can prefer the signed-in one.
/// Only the `cli` build ranks providers this way.
#[cfg(feature = "cli")]
fn credentialed(config: &ProviderConfig) -> bool {
    config.api_key.is_some() || !config.api_keys.is_empty()
}

/// Which provider serves `model_id`, given the provider map. The single
/// implementation of the routing order, so anything that *reports* on a
/// request (its price, its context window, its header label) names the
/// provider the request is actually sent to:
///
/// 1. a provider listing the id verbatim - reachable and credentialed first,
///    then any, so a keyless twin does not shadow the signed-in entry;
/// 2. a `<provider>/` prefix naming a configured provider;
/// 3. a provider whose key *is* the model id (a local engine alias).
///
/// Sync and lock-free (the caller holds the map), so a render path or a price
/// lookup can ask without awaiting the async resolver.
pub(crate) fn pick_provider_for_model(
    model_id: &str,
    pc: &HashMap<String, ProviderConfig>,
) -> Option<String> {
    let offers = |config: &ProviderConfig| config.models.iter().any(|m| m == model_id);

    // The same model id can be listed by several providers, e.g. a cloud
    // provider and an OpenAI-compatible gateway that both carry e.g.
    // `gpt-4o`. `HashMap` iteration order is randomized, so pick determin-
    // istically rather than whichever hashes first. When several reachable
    // HTTP providers offer the model, prefer a credentialed one over a
    // keyless twin: the keyless entry (typically the user's own catalog
    // entry that was never signed in) would only fail later with a 401 even
    // though a signed-in provider offering the same model would have worked.
    // Sort key is `(has_credential DESC, name ASC)` so equally-credentialed
    // entries still resolve to a stable, alphabetical name.
    #[cfg(feature = "cli")]
    let first_match = pc
        .iter()
        .filter(|(_, config)| {
            config.base_url.as_deref().is_some_and(|u| !u.is_empty()) && offers(config)
        })
        .min_by_key(|(name, config)| (Reverse(credentialed(config)), name.to_string()))
        .or_else(|| pc.iter().find(|(_, config)| offers(config)));
    #[cfg(not(feature = "cli"))]
    let first_match = pc.iter().find(|(_, config)| offers(config));

    first_match
        .map(|(_, config)| config.provider.clone())
        .or_else(|| {
            if let Some(sep_pos) = model_id.find('/') {
                let potential_provider: &str = &model_id[..sep_pos];
                if pc.contains_key(potential_provider) {
                    return Some(potential_provider.to_string());
                }
            }
            pc.get(model_id).map(|c| c.provider.clone())
        })
}

/// Resolve `model_id` to an upstream URL + key chain. The desktop build also
/// resolves local engines (MLX session, llama-server router); the `cli` build is
/// remote-only, so a model with no provider entry is unresolvable.
pub(crate) async fn resolve_upstream_for_model(
    model_id: &str,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    #[cfg(not(feature = "cli"))] llama_state: Arc<LlamacppState>,
    #[cfg(not(feature = "cli"))] mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
) -> Result<(String, Vec<String>), String> {
    let destination_path = "/chat/completions";

    let pc = provider_configs.lock().await;
    let provider_name = pick_provider_for_model(model_id, &pc);
    drop(pc);

    if let Some(provider) = provider_name {
        let provider_cfg = provider_configs
            .lock()
            .await
            .get(provider.as_str())
            .cloned();
        if let Some(provider_cfg) = provider_cfg {
            // A populated base_url means an HTTP upstream (cloud, or a local
            // engine whose live endpoint was registered at runtime). A local
            // engine loaded from persisted settings has none -- fall through to
            // the MLX session / llama-server router resolution below.
            if let Some(api_url) = provider_cfg.base_url.clone().filter(|u| !u.is_empty()) {
                // A registered account takes its OAuth access token (refreshed if
                // needed) ahead of any stored API key. Account auth is a `cli`
                // concern; the desktop resolves credentials through its own
                // proxy path and falls back to the bearer key chain here.
                #[cfg(feature = "cli")]
                let (api_url, api_keys) = {
                    let account_token =
                        crate::core::cli::auth::account::access_token(&provider_cfg.provider)
                            .await?;
                    let api_url = if provider_cfg.provider == "openai"
                        && account_token.is_some()
                        && api_url.trim_end_matches('/') == "https://api.openai.com/v1"
                    {
                        "https://chatgpt.com/backend-api".to_string()
                    } else {
                        api_url
                    };
                    let api_keys = account_token
                        .map(|token| vec![token])
                        .unwrap_or_else(|| provider_cfg.bearer_key_chain());
                    (api_url, api_keys)
                };
                #[cfg(not(feature = "cli"))]
                let api_keys = provider_cfg.bearer_key_chain();
                let url = format!("{}{}", api_url, destination_path);
                #[cfg(feature = "cli")]
                {
                    if api_keys.is_empty() {
                        let mut provider_cfg = provider_cfg;
                        crate::core::cli::providers::hydrate_provider_keys(&mut provider_cfg);
                        return Ok((url, provider_cfg.bearer_key_chain()));
                    }
                    return Ok((url, api_keys));
                }
                #[cfg(not(feature = "cli"))]
                return Ok((url, api_keys));
            }
        }
    }

    #[cfg(not(feature = "cli"))]
    {
        let mlx_guard = mlx_sessions.lock().await;
        if let Some(info) = mlx_guard.values().find(|s| s.info.model_id == model_id) {
            let target_port = info.info.port;
            return Ok((
                format!("http://127.0.0.1:{target_port}/v1{destination_path}"),
                vec![info.info.api_key.clone()],
            ));
        }
        drop(mlx_guard);

        if let Some((url, key)) = engine_upstream(&llama_state, destination_path).await {
            return Ok((url, vec![key]));
        }
    }

    Err(format!("No upstream session found for model '{model_id}'"))
}
/// Strip a leading `<provider>/` qualifier from `model_id` when that prefix
/// names a configured provider, mirroring the disambiguation in
/// [`resolve_upstream_for_model`]. `provider/model` is the CLI's explicit
/// selection syntax; once the upstream URL and credential are resolved the
/// request body must carry the bare model id, or providers that reject a
/// provider-qualified id (e.g. OpenCode GO) fail with "model not supported".
/// A slash inside a real model id (e.g. an org-scoped name) is left alone
/// unless the leading segment is literally a provider key.
///
/// A provider that lists the id verbatim wins over the prefix reading, exactly
/// as resolution orders them: a gateway routing `anthropic/claude-opus-5` is
/// serving a model whose id contains a slash, and stripping it because some
/// *other* configured provider happens to be named `anthropic` sends an id the
/// gateway has never heard of.
pub(crate) fn strip_provider_prefix(
    model_id: &str,
    provider_configs: &HashMap<String, ProviderConfig>,
) -> String {
    if provider_configs
        .values()
        .any(|c| c.models.iter().any(|m| m == model_id))
    {
        return model_id.to_string();
    }
    if let Some(sep_pos) = model_id.find('/') {
        let potential_provider: &str = &model_id[..sep_pos];
        if provider_configs.contains_key(potential_provider) {
            return model_id[sep_pos + 1..].to_string();
        }
    }
    model_id.to_string()
}

/// Resolve the wire API for `model_id`'s provider, mirroring the
/// model-to-provider lookup in [`resolve_upstream_for_model`]. Returns the
/// provider's `api_type` and whether its credential is an OAuth account token
/// rather than an API key, when the model maps to a reachable HTTP provider
/// that declares a non-default wire API. `None` otherwise (OpenAI
/// chat/completions or a model with no provider entry).
pub(crate) async fn resolve_api_type_for_model(
    model_id: &str,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
) -> Option<(String, bool)> {
    let pc = provider_configs.lock().await;
    let offers = |config: &ProviderConfig| config.models.iter().any(|m| m == model_id);

    // A converter is only meaningful for an HTTP provider (it needs a base_url
    // to append the native path to), so prefer a reachable entry and otherwise
    // fall back to the first model-claiming entry, exactly as resolution does.
    #[cfg(feature = "cli")]
    let first_match = pc
        .iter()
        .filter(|(_, config)| {
            config.base_url.as_deref().is_some_and(|u| !u.is_empty()) && offers(config)
        })
        .min_by_key(|(name, config)| (Reverse(credentialed(config)), name.to_string()))
        .or_else(|| pc.iter().find(|(_, config)| offers(config)));
    #[cfg(not(feature = "cli"))]
    let first_match = pc.iter().find(|(_, config)| offers(config));

    let provider_name = first_match
        .map(|(_, config)| config.provider.clone())
        .or_else(|| {
            if let Some(sep_pos) = model_id.find('/') {
                let potential_provider: &str = &model_id[..sep_pos];
                if pc.contains_key(potential_provider) {
                    return Some(potential_provider.to_string());
                }
            }
            pc.get(model_id).map(|c| c.provider.clone())
        });
    let cfg = provider_name.and_then(|p| pc.get(&p).cloned());
    drop(pc);

    let api_type = cfg.as_ref().and_then(|c| c.api_type.clone())?;
    // OAuth account login is a `cli` feature; resolve the auth scheme from
    // the stored credential so a plain API key stays on its key scheme.
    #[cfg(feature = "cli")]
    let oauth = cfg
        .as_ref()
        .map(|c| crate::core::cli::auth::account::has_oauth_credential(&c.provider))
        .unwrap_or(false);
    #[cfg(not(feature = "cli"))]
    let oauth = false;
    Some((api_type, oauth))
}

pub(crate) fn copy_optional_chat_params(
    from: &serde_json::Value,
    into: &mut serde_json::Map<String, serde_json::Value>,
) {
    for key in [
        "temperature",
        "top_p",
        "top_k",
        "max_tokens",
        "stop_sequences",
        "stop",
        "frequency_penalty",
        "presence_penalty",
        "reasoning_effort",
    ] {
        if let Some(v) = from.get(key) {
            into.insert(key.to_string(), v.clone());
        }
    }
}

/// One MCP tool already rendered into the OpenAI `function` shape, paired with
/// the tool name used for ordering and for `tool_to_server` lookup.
type RenderedTool = (String, serde_json::Value);

/// Ordering key for the advertised tool array: `(server name, tool name)`.
///
/// The tool array is part of the request *prefix*, and providers cache prefixes
/// on bytes, so its order has to be a function of configuration alone. Emission
/// used to follow `servers.iter()`, and that walks a `HashMap` whose iteration
/// order is randomized per process - so every app restart advertised the same
/// tools in a different order and paid a cold cache for an otherwise identical
/// session. Keying on the pair keeps one server's tools contiguous and stays
/// stable when the same tool name is exposed by two servers.
fn tool_sort_key<'a>(server_name: &'a str, tool_name: &'a str) -> (&'a str, &'a str) {
    (server_name, tool_name)
}

/// Last successful listing per MCP server, for the lifetime of the process.
fn last_good_listings() -> &'static std::sync::Mutex<HashMap<String, Vec<RenderedTool>>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, Vec<RenderedTool>>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Resolve each server's listing attempt against the last-known-good one.
///
/// A server that fails or times out reuses its previous listing rather than
/// dropping out of the array: a transient MCP hiccup would otherwise shrink the
/// advertised tools mid-session, invalidating the cached prefix on that turn and
/// again on the turn the server comes back. A server that has never listed
/// successfully is still omitted - there is nothing to reuse.
///
/// `listings` is assumed to cover every configured server (every caller probes
/// the whole `SharedMcpServers` map and filters afterwards), so a server absent
/// from it has been removed and its cached listing is dropped. That keeps the
/// cache from growing across a long session, and means removing a server changes
/// the array exactly once, at the point of the change.
fn reuse_last_good_listings(
    cache: &mut HashMap<String, Vec<RenderedTool>>,
    listings: Vec<(String, Option<Vec<RenderedTool>>)>,
) -> Vec<(String, Vec<RenderedTool>)> {
    let probed: std::collections::HashSet<String> =
        listings.iter().map(|(name, _)| name.clone()).collect();
    cache.retain(|name, _| probed.contains(name));

    let mut resolved = Vec::with_capacity(listings.len());

    for (server_name, tools) in listings {
        match tools {
            Some(tools) => {
                cache.insert(server_name.clone(), tools.clone());
                resolved.push((server_name, tools));
            }
            None => match cache.get(&server_name) {
                Some(tools) => {
                    log::warn!(
                        "Reusing last known tool listing for MCP server {} ({} tools)",
                        server_name,
                        tools.len()
                    );
                    resolved.push((server_name, tools.clone()));
                }
                None => {
                    log::warn!(
                        "MCP server {} has no known tool listing; omitting it from this request",
                        server_name
                    );
                }
            },
        }
    }

    resolved
}

/// Flatten the per-server listings into the advertised array, ordered by
/// [`tool_sort_key`], with `tool_to_server` kept consistent with that order.
fn assemble_tool_array(
    listings: Vec<(String, Vec<RenderedTool>)>,
) -> (Vec<serde_json::Value>, HashMap<String, String>) {
    let mut flattened: Vec<(String, String, serde_json::Value)> = listings
        .into_iter()
        .flat_map(|(server_name, tools)| {
            tools
                .into_iter()
                .map(move |(tool_name, tool)| (server_name.clone(), tool_name, tool))
        })
        .collect();

    flattened.sort_by(|(a_server, a_tool, _), (b_server, b_tool, _)| {
        tool_sort_key(a_server, a_tool).cmp(&tool_sort_key(b_server, b_tool))
    });

    let mut openai_tools = Vec::with_capacity(flattened.len());
    let mut tool_to_server: HashMap<String, String> = HashMap::new();
    for (server_name, tool_name, tool) in flattened {
        tool_to_server.insert(tool_name, server_name);
        openai_tools.push(tool);
    }

    (openai_tools, tool_to_server)
}

pub(crate) async fn collect_mcp_openai_tools(
    mcp_servers: &SharedMcpServers,
    mcp_settings: &Arc<Mutex<McpSettings>>,
) -> Result<(Vec<serde_json::Value>, HashMap<String, String>), String> {
    let timeout_duration = mcp_settings.lock().await.tool_call_timeout_duration();
    let servers = mcp_servers.lock().await;

    // Probe every server concurrently so one slow/hanging server can't serialize
    // the whole collection behind its timeout (previously each server waited out
    // the full timeout before the next was contacted).
    let listings =
        futures_util::future::join_all(servers.iter().map(|(server_name, service)| async move {
            let result =
                match tokio::time::timeout(timeout_duration, service.list_all_tools()).await {
                    Ok(Ok(tools)) => Some(
                        tools
                            .iter()
                            .map(|tool| {
                                // Normalize schemas before sending them to strict
                                // OpenAI-compatible providers. The `get_tools` Tauri
                                // command still returns raw schemas; the frontend
                                // normalizes those separately before provider registration.
                                let mut parameters =
                                    serde_json::Value::Object((*tool.input_schema).clone());
                                normalize_openai_tool_parameters_schema(&mut parameters);
                                let description = tool
                                    .description
                                    .as_ref()
                                    .map(|d| d.to_string())
                                    .unwrap_or_default();

                                (
                                    tool.name.to_string(),
                                    serde_json::json!({
                                        "type": "function",
                                        "function": {
                                            "name": tool.name,
                                            "description": description,
                                            "parameters": parameters
                                        }
                                    }),
                                )
                            })
                            .collect::<Vec<RenderedTool>>(),
                    ),
                    Ok(Err(e)) => {
                        log::warn!("MCP server {} failed to list tools: {}", server_name, e);
                        None
                    }
                    Err(_) => {
                        log::warn!(
                            "Listing MCP tools timed out after {} seconds on server {}",
                            timeout_duration.as_secs(),
                            server_name
                        );
                        None
                    }
                };
            (server_name.clone(), result)
        }))
        .await;

    let resolved = {
        let mut cache = last_good_listings()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        reuse_last_good_listings(&mut cache, listings)
    };

    Ok(assemble_tool_array(resolved))
}

pub(crate) async fn execute_mcp_tool_calls(
    tool_calls: &[serde_json::Value],
    tool_to_server: &HashMap<String, String>,
    mcp_servers: &SharedMcpServers,
    mcp_settings: &Arc<Mutex<McpSettings>>,
) -> Vec<(String, String)> {
    let (timeout_duration, tool_output_cap) = {
        let settings = mcp_settings.lock().await;
        (
            settings.tool_call_timeout_duration(),
            settings.tool_output_cap(None),
        )
    };
    let servers = mcp_servers.lock().await;

    let mut results = Vec::with_capacity(tool_calls.len());

    for tc in tool_calls {
        let tool_call_id = tc
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let tool_name = tc
            .get("function")
            .and_then(|f| f.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let args_str = tc
            .get("function")
            .and_then(|f| f.get("arguments"))
            .and_then(|v| v.as_str())
            .unwrap_or("{}");

        let args_value: serde_json::Value =
            serde_json::from_str(args_str).unwrap_or_else(|_| serde_json::json!({}));

        let args_map: serde_json::Map<String, serde_json::Value> =
            if let Some(obj) = args_value.as_object() {
                obj.clone()
            } else {
                serde_json::Map::new()
            };

        let Some(server_name) = tool_to_server.get(&tool_name) else {
            results.push((
                tool_call_id,
                format!("ERROR: No MCP server registered for tool '{tool_name}'"),
            ));
            continue;
        };

        let Some(service) = servers.get(server_name) else {
            results.push((
                tool_call_id,
                format!("ERROR: MCP server '{server_name}' not found in runtime state"),
            ));
            continue;
        };

        let tool_call = service.call_tool(
            CallToolRequestParams::new(tool_name.clone()).with_arguments(args_map),
        );

        let result = match tokio::time::timeout(timeout_duration, tool_call).await {
            Ok(call_result) => call_result.map_err(|e| e.to_string()),
            Err(_) => Err(format!(
                "Tool call '{tool_name}' timed out after {} seconds",
                timeout_duration.as_secs()
            )),
        };

        let tool_result_string = match result {
            // Same cap as the desktop path: this string is appended to the agent's
            // message history, so an unbounded result would blow the context here too.
            Ok(res) => mcp_call_result_to_string(&truncate_tool_result(&res, tool_output_cap)),
            Err(e) => format!("ERROR: {e}"),
        };

        results.push((tool_call_id, tool_result_string));
    }

    results
}

#[cfg(not(feature = "cli"))]
pub(crate) async fn call_openai_chat_completions(
    client: &Client,
    upstream_url: &str,
    api_keys: &[String],
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let attempts: Vec<Option<&str>> = if api_keys.is_empty() {
        vec![None]
    } else {
        api_keys.iter().map(|s| Some(s.as_str())).collect()
    };

    let mut last_err = String::new();
    for (i, key_ref) in attempts.iter().enumerate() {
        let mut req = client
            .post(upstream_url)
            .header("Content-Type", "application/json")
            .header("Accept-Encoding", "identity");

        if let Some(key) = key_ref {
            req = req.header("Authorization", format!("Bearer {key}"));
        }

        let resp = send_with_one_retry(req.body(body.to_string())).await?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| {
            format!(
                "Reading the upstream response failed ({upstream_url}): {}",
                describe_request_error(&e)
            )
        })?;

        if status.is_success() {
            return serde_json::from_str::<serde_json::Value>(&text)
                .map_err(|e| format!("Failed to parse upstream JSON: {e}. Body: {text}"));
        }

        last_err = format!("Upstream returned HTTP {status}: {text}");
        if should_try_next_api_key(status) && i + 1 < attempts.len() {
            log::warn!("OpenAI completion: HTTP {status} with API key index {i}, trying next key");
            continue;
        }

        return Err(last_err);
    }

    Err(last_err)
}

/// Streaming counterpart of [`call_openai_chat_completions`]. Forces `stream:true`
/// (with usage), emits `StreamEvent::Token` per content delta, and reconstructs
/// an OpenAI non-streaming completion JSON so the rest of the loop (tool-call
/// extraction, history append) is identical to the non-streaming path.
/// Stable marker prefixed onto an upstream error when the failure looks like a
/// context/prompt-length overflow, so the agent loop can react (compact + retry)
/// instead of surfacing the raw provider error. Works uniformly for local
/// (llama-server) and remote (OpenAI/Anthropic/Google) since all report overflow
/// via an HTTP error body rather than the streamed deltas.
pub(crate) const CONTEXT_OVERFLOW_MARKER: &str = "context-overflow";

/// True when a provider error body reads like a context/prompt-length overflow.
/// Matches the OpenAI `context_length_exceeded` code, Anthropic's "prompt is too
/// long", Google's token-limit phrasing, and llama-server's context messages.
pub(crate) fn is_context_overflow_body(body: &str) -> bool {
    let b = body.to_lowercase();
    b.contains("context_length_exceeded")
        || b.contains("maximum context length")
        || b.contains("prompt is too long")
        || b.contains("exceeds the maximum number of tokens")
        || b.contains("the request exceeds the available context")
        || b.contains("exceeds the available context size")
        || b.contains("exceed_context_size_error")
        || b.contains("exceed context")
        || b.contains("context window")
        || (b.contains("context") && b.contains("too long"))
}

/// True when an error string carries the [`CONTEXT_OVERFLOW_MARKER`].
pub(crate) fn is_context_overflow_error(err: &str) -> bool {
    err.contains(CONTEXT_OVERFLOW_MARKER)
}

/// True when the upstream rejected the request *because* an assistant turn
/// carries `reasoning_content`. The field is a DeepSeek extension that some
/// providers require to be resent (llama.cpp `preserve_thinking`) while strict
/// OpenAI-compatible endpoints (Groq, vLLM's pydantic validation) reject the
/// whole request rather than ignoring the unknown key. Recognizing it lets the
/// caller drop the field and retry instead of failing the turn, so
/// `send_reasoning` does not have to be configured per provider by hand.
/// Requires both the field name and a rejection phrase: a body that merely
/// echoes the request must not be read as a rejection of it.
pub(crate) fn is_reasoning_field_error(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("reasoning_content")
        && [
            "unsupported",
            "unrecognized",
            "unknown",
            "not permitted",
            "not allowed",
            "unexpected",
            "additional",
            "extra input",
            "extra field",
            "invalid",
        ]
        .iter()
        .any(|phrase| e.contains(phrase))
}

/// Every message in an error's `source()` chain, outermost cause first.
/// `reqwest::Error` prints only its own layer -- `error sending request for url
/// (...)` -- so the reason the request never left (DNS failure, refused
/// connection, TLS mismatch, dropped socket) is one or more sources down and is
/// otherwise lost to the user. Consecutive duplicates are collapsed: hyper and
/// its io error often stringify identically.
#[cfg(any(not(feature = "cli"), test))]
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

/// True when a failed send can be retried safely: the connection died before any
/// response arrived, so nothing has been streamed to the caller and no side
/// effect on the upstream is implied. Covers a refused/failed connect and the
/// stale-keep-alive family -- hyper reports a pooled connection the peer had
/// already closed as `connection closed before message completed`, or as an
/// `ECONNRESET`/`EPIPE` io error if the RST lands while the request is going
/// out. A timeout is deliberately excluded: retrying one doubles the wait.
#[cfg(not(feature = "cli"))]
fn is_retryable_send_error(err: &reqwest::Error) -> bool {
    if err.is_timeout() || err.is_body() || err.is_decode() || err.is_builder() {
        return false;
    }
    err.is_connect() || chain_indicates_dropped_connection(&error_source_chain(err))
}

/// Whether an error's cause chain names a connection the peer dropped. Matched
/// on text because the io error is several opaque layers down (hyper's
/// `SendRequest` -> `connection error` -> `std::io::Error`) and its `ErrorKind`
/// is not exposed through `reqwest`.
#[cfg(not(feature = "cli"))]
fn chain_indicates_dropped_connection(chain: &[String]) -> bool {
    const MARKERS: &[&str] = &[
        "connection closed before message completed",
        "connection reset by peer",
        "broken pipe",
        "connection aborted",
        "unexpected eof",
    ];
    chain.iter().any(|msg| {
        let msg = msg.to_lowercase();
        MARKERS.iter().any(|m| msg.contains(m))
    })
}

/// How long to wait before the one retry of a dropped connection. Long enough
/// for a load balancer that just recycled a backend to finish, short enough that
/// the user does not read it as a hang.
#[cfg(not(feature = "cli"))]
const SEND_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(250);

/// Send a request, retrying it once when the connection dropped before any
/// response arrived. This is the failure a long turn invites: while tools run
/// locally no bytes flow, an idle keep-alive connection is reclaimed by the peer
/// or its load balancer, and the next turn's request is written into a socket
/// that is already gone. Retrying is safe precisely because nothing was received
/// -- see [`is_retryable_send_error`].
#[cfg(not(feature = "cli"))]
async fn send_with_one_retry(req: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    // `try_clone` returns `None` only for a streaming body; every caller here
    // sends a `String`, so the retry path is always available in practice.
    let retry = req.try_clone();
    let first = match req.send().await {
        Ok(resp) => return Ok(resp),
        Err(e) => e,
    };
    let Some(retry) = retry.filter(|_| is_retryable_send_error(&first)) else {
        return Err(format!(
            "Upstream request failed: {}",
            describe_request_error(&first)
        ));
    };
    log::warn!(
        "upstream: {} -- retrying once",
        describe_request_error(&first)
    );
    tokio::time::sleep(SEND_RETRY_DELAY).await;
    retry.send().await.map_err(|e| {
        format!(
            "Upstream request failed after one retry: {} (first attempt: {})",
            describe_request_error(&e),
            describe_request_error(&first)
        )
    })
}

/// The HTTP client every agent turn goes through. Agent traffic now runs on
/// `genai`, which is built against reqwest 0.13, so this is the aliased crate
/// rather than the 0.12 `Client` the rest of the app (and the API server below)
/// uses. Pool tuning lives with the builder in [`super::genai_bridge`].
pub(crate) fn agent_http_client() -> reqwest13::Client {
    super::genai_bridge::shared_http_client()
}

/// The converted native-wire path can rotate through configured credentials on
/// the same auth failures as the desktop proxy.
fn should_try_next_api_key(status: reqwest::StatusCode) -> bool {
    matches!(
        status,
        reqwest::StatusCode::UNAUTHORIZED
            | reqwest::StatusCode::FORBIDDEN
            | reqwest::StatusCode::TOO_MANY_REQUESTS
    )
}

/// Names the proxy environment variables in force, without their values (they
/// routinely carry credentials). A proxy set in the environment is a common
/// reason a request fails for Jan and for nothing else, and it is invisible in
/// the error itself.
#[cfg(any(not(feature = "cli"), test))]
fn proxy_env_hint() -> Option<String> {
    const VARS: &[&str] = &[
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
    ];
    let set: Vec<&str> = VARS
        .iter()
        .copied()
        .filter(|name| {
            std::env::var_os(name).is_some_and(|v| !v.to_string_lossy().trim().is_empty())
        })
        .collect();
    (!set.is_empty()).then(|| format!("proxy env set: {}", set.join(", ")))
}

/// A failed HTTP request described well enough to act on: what stage failed, the
/// `reqwest` message, its whole cause chain, and -- for a connect or timeout
/// failure, where the environment is usually the culprit -- which proxy
/// variables are set.
#[cfg(not(feature = "cli"))]
pub(crate) fn describe_request_error(err: &reqwest::Error) -> String {
    let stage = if err.is_timeout() {
        "timed out"
    } else if err.is_connect() {
        "could not connect"
    } else if err.is_redirect() {
        "too many redirects"
    } else if err.is_body() || err.is_decode() {
        "response body failed"
    } else if err.is_builder() {
        "request could not be built"
    } else {
        "send failed"
    };
    let mut msg = format!("{stage}: {err}");
    let chain = error_source_chain(err);
    if !chain.is_empty() {
        msg.push_str(&format!(" (caused by: {})", chain.join(" <- ")));
    }
    if let Some(status) = err.status() {
        msg.push_str(&format!(" [HTTP {status}]"));
    }
    if err.is_connect() || err.is_timeout() {
        if let Some(hint) = proxy_env_hint() {
            msg.push_str(&format!(" [{hint}]"));
        }
    }
    msg
}

/// Stream a chat completion for the agent loop.
///
/// A thin delegate to [`super::genai_bridge`], which owns the wire format, SSE
/// handling, provider field-name variance, and the retry policy. Every provider
/// the agent talks to comes through here -- cloud, a Jan desktop API server, a
/// local llama.cpp router, an MLX session -- so there is exactly one upstream
/// implementation to reason about.
///
/// `api_type` selects the `genai` adapter. It is `None` for every caller today:
/// the agent has always spoken OpenAI `/chat/completions` regardless of a
/// provider's configured `api_type`, and honoring it here would silently change
/// the wire format for an existing config. The API server's own converters
/// (`core::server::converters`) remain the only consumer of that field.
pub(crate) async fn stream_openai_chat_completions(
    client: &reqwest13::Client,
    upstream_url: &str,
    api_keys: &[String],
    api_type: Option<&str>,
    body: &serde_json::Value,
    events: &mpsc::UnboundedSender<StreamEvent>,
) -> Result<serde_json::Value, String> {
    super::genai_bridge::stream_chat_completions(
        client,
        upstream_url,
        api_keys,
        api_type,
        body,
        events,
    )
    .await
}

/// Streaming counterpart of [`stream_openai_chat_completions`] for providers
/// that speak a native (non-chat/completions) wire API. Uses the provider's
/// [`UpstreamConverter`] to rewrite the request body, point at the native path,
/// and translate the upstream stream back into chat/completions SSE chunks,
/// which are then fed through the same [`SseAccumulator::ingest_line`] decode
/// as the OpenAI path so `StreamEvent`s (Token / ToolCallStarted /
/// ToolCallArgsDelta) are emitted identically.
///
/// `upstream_url` is the resolved base + "/chat/completions" (see
/// [`resolve_upstream_for_model`]); the base is recovered by stripping that
/// suffix and the native path appended in its place.
pub(crate) async fn stream_converted_chat_completions(
    client: &Client,
    upstream_url: &str,
    api_keys: &[String],
    converter: &dyn UpstreamConverter,
    body: &serde_json::Value,
    events: &mpsc::UnboundedSender<StreamEvent>,
) -> Result<serde_json::Value, String> {
    // Base is upstream_url minus the trailing "/chat/completions". Recover it
    // the same way the proxy does when it swaps the destination path.
    let base = upstream_url
        .strip_suffix("/chat/completions")
        .unwrap_or(upstream_url)
        .trim_end_matches('/');
    let native_path = converter.upstream_path(body);
    let native_url = format!("{base}{native_path}");

    // Force streaming so the converter emits the SSE form and `upstream_path`
    // (Google) selects the `?alt=sse` variant, matching the OpenAI path.
    let mut native_body = body.clone();
    if let Some(obj) = native_body.as_object_mut() {
        obj.insert("stream".to_string(), serde_json::json!(true));
    }
    let native_body = converter.convert_request(&native_body);

    let attempts: Vec<Option<&str>> = if api_keys.is_empty() {
        vec![None]
    } else {
        api_keys.iter().map(|s| Some(s.as_str())).collect()
    };

    let mut last_err = String::new();
    for (i, key_ref) in attempts.iter().enumerate() {
        let mut req = client
            .post(&native_url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("Accept-Encoding", "identity");

        // The converter decides the auth scheme (Bearer default, but Google
        // uses x-goog-api-key and Anthropic x-api-key).
        if let Some(key) = key_ref {
            let (auth_name, auth_value) = converter.auth_header(key);
            req = req.header(auth_name, auth_value);
            for (name, value) in converter.credential_headers(key) {
                req = req.header(name, value);
            }
        }
        // Fixed headers the native API requires (Anthropic: anthropic-version).
        for (name, value) in converter.extra_headers() {
            req = req.header(name, value);
        }

        let resp = req
            .body(native_body.to_string())
            .send()
            .await
            .map_err(|e| format!("Upstream request failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            last_err = format!("Upstream returned HTTP {status}: {text}");
            if is_context_overflow_body(&text) {
                last_err = format!("[{CONTEXT_OVERFLOW_MARKER}] {last_err}");
            }
            if should_try_next_api_key(status) && i + 1 < attempts.len() {
                log::warn!(
                    "converted stream: HTTP {status} with API key index {i}, trying next key"
                );
                continue;
            }
            return Err(last_err);
        }

        // Every converted call above requests a stream. Some native backends
        // (notably ChatGPT Codex) omit Content-Type on a valid SSE response, so
        // absence means SSE; an explicit non-SSE type remains the JSON fallback.
        let is_sse = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|ct| ct.contains("event-stream"))
            .unwrap_or(true);

        if is_sse {
            return consume_converted_sse(resp, converter, events).await;
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Upstream body read failed: {e}"))?;
        return decode_converted_response(&bytes, converter);
    }

    Err(last_err)
}

/// Read a native SSE stream, translating each event through `converter` and
/// feeding the produced chat-shaped chunks into the OpenAI [`SseAccumulator`]
/// so `StreamEvent`s match the chat/completions path exactly.
async fn consume_converted_sse(
    resp: reqwest::Response,
    converter: &dyn UpstreamConverter,
    events: &mpsc::UnboundedSender<StreamEvent>,
) -> Result<serde_json::Value, String> {
    let mut stream = resp.bytes_stream();
    let mut frame = crate::core::server::converters::SseAccumulator::new();
    let mut state = crate::core::server::converters::StreamState::default();
    // Reassembles the translated chat/completions SSE into one completion.
    let mut acc = SseAccumulator::default();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Upstream stream error: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        for event in frame.push(&text) {
            for payload in converter.convert_stream_event(&event, &mut state) {
                // Each payload is one chat-shaped JSON chunk or `[DONE]`.
                acc.ingest(&payload, events);
            }
        }
    }
    if let Some(event) = frame.finish() {
        for payload in converter.convert_stream_event(&event, &mut state) {
            acc.ingest(&payload, events);
        }
    }

    if let Some(err) = acc.error.take() {
        let msg = format!("Upstream stream error: {err}");
        return Err(if is_context_overflow_body(&err) {
            format!("[{CONTEXT_OVERFLOW_MARKER}] {msg}")
        } else {
            msg
        });
    }

    Ok(acc.into_completion())
}

/// Translate a non-streaming native response into a chat.completion object.
fn decode_converted_response(
    bytes: &[u8],
    converter: &dyn UpstreamConverter,
) -> Result<serde_json::Value, String> {
    let upstream: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| format!("Upstream returned invalid JSON: {e}"))?;
    let completion = converter.convert_response(&upstream);
    if let Some(err) = completion.get("error") {
        let message = err
            .get("message")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| err.to_string());
        let msg = format!("Upstream stream error: {message}");
        return Err(if is_context_overflow_body(&message) {
            format!("[{CONTEXT_OVERFLOW_MARKER}] {msg}")
        } else {
            msg
        });
    }
    Ok(completion)
}

#[derive(Default)]
struct ToolCallAccum {
    id: String,
    name: String,
    arguments: String,
    /// A `ToolCallStarted` was already emitted for this call; guards the
    /// once-per-call in-progress signal against later argument deltas.
    started_emitted: bool,
    /// Bytes of `arguments` already forwarded as `ToolCallArgsDelta`. Zero
    /// until the first forward, which replays whatever arrived before the call
    /// could be announced.
    args_forwarded: usize,
}

/// Accumulates OpenAI SSE deltas into a single reconstructed completion. Kept
/// separate from the byte-stream reader so it is unit-testable without a live
/// HTTP response.
#[derive(Default)]
struct SseAccumulator {
    content: String,
    /// Natively streamed reasoning (`reasoning_content` deltas), accumulated so
    /// the reconstructed completion carries it back on the assistant message.
    /// Kept apart from `content`: reasoning is never part of the answer prose,
    /// but a caller resending assistant turns may forward it to the model.
    reasoning: String,
    tool_calls: Vec<ToolCallAccum>,
    finish_reason: Option<String>,
    usage: Option<serde_json::Value>,
    /// An error object delivered inside the stream (`data: {"error": {...}}`).
    /// OpenAI-compatible upstreams can fail mid-stream after a `200 OK`; without
    /// capturing it the run would end as a silent "no answer" instead of
    /// surfacing the failure. The converted-stream reader turns it into an error.
    error: Option<String>,
}

impl SseAccumulator {
    /// Parse one raw SSE line (`data: {...}`); non-`data:`/blank lines are ignored.
    #[cfg(test)]
    fn ingest_line(&mut self, line: &str, events: &mpsc::UnboundedSender<StreamEvent>) {
        if let Some(rest) = line.trim_end_matches('\r').strip_prefix("data:") {
            let data = rest.trim();
            if !data.is_empty() {
                self.ingest(data, events);
            }
        }
    }

    fn ingest(&mut self, data: &str, events: &mpsc::UnboundedSender<StreamEvent>) {
        if data == "[DONE]" {
            return;
        }
        let json: serde_json::Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(err) = json.get("error").filter(|e| !e.is_null()) {
            let message = err
                .get("message")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| err.to_string());
            let kind = err.get("type").and_then(|v| v.as_str());
            self.error = Some(match kind {
                Some(t) if !t.is_empty() => format!("{t}: {message}"),
                _ => message,
            });
            return;
        }

        if let Some(u) = json.get("usage") {
            if !u.is_null() {
                self.usage = Some(u.clone());
            }
        }

        let Some(choice) = json
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first())
        else {
            return;
        };

        if let Some(fr) = choice.get("finish_reason").and_then(|v| v.as_str()) {
            self.finish_reason = Some(fr.to_string());
        }

        let Some(delta) = choice.get("delta") else {
            return;
        };

        // Native reasoning: providers exposing a dedicated `reasoning_content`
        // field stream it as `Reasoning` events, never as content tokens, so
        // consumers get the boundary for free instead of re-parsing synthetic
        // `<think>` tags. Providers that inline tags in `content` still flow
        // through `Token`; consumers keep the tag-stripping fallback for them.
        if let Some(text) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                self.reasoning.push_str(text);
                let _ = events.send(StreamEvent::Reasoning {
                    text: text.to_string(),
                });
            }
        }

        if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                self.content.push_str(text);
                let _ = events.send(StreamEvent::Token {
                    text: text.to_string(),
                });
            }
        }

        if let Some(tcs) = delta.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tcs {
                let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                while self.tool_calls.len() <= idx {
                    self.tool_calls.push(ToolCallAccum::default());
                }
                let slot = &mut self.tool_calls[idx];
                if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        slot.id = id.to_string();
                    }
                }
                let func = tc.get("function");
                if let Some(name) = func
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .filter(|n| !n.is_empty())
                {
                    slot.name = name.to_string();
                }
                let arg_delta = func
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                if let Some(arg) = arg_delta {
                    slot.arguments.push_str(arg);
                }

                // Signal the in-progress tool call the instant both id and name
                // are known, so consumers can show activity while arguments are
                // still streaming (a long window for large write/edit calls).
                if !slot.started_emitted && !slot.id.is_empty() && !slot.name.is_empty() {
                    slot.started_emitted = true;
                    let _ = events.send(StreamEvent::ToolCallStarted {
                        id: slot.id.clone(),
                        name: slot.name.clone(),
                    });
                }

                // Forward the argument text itself, but only once the call has
                // been announced -- a delta with no preceding `ToolCallStarted`
                // has no call for the consumer to attach it to. Providers that
                // send arguments before the id/name are covered by the replay
                // below, which flushes what was buffered before the announce.
                if slot.started_emitted {
                    if let Some(arg) = arg_delta {
                        let delta = if slot.args_forwarded == 0 {
                            // First forward after the announce: ship everything
                            // accumulated so far, including any chunks that
                            // arrived before id/name were known.
                            slot.arguments.clone()
                        } else {
                            arg.to_string()
                        };
                        slot.args_forwarded = slot.arguments.len();
                        let _ = events.send(StreamEvent::ToolCallArgsDelta {
                            id: slot.id.clone(),
                            delta,
                        });
                    }
                }
            }
        }
    }

    fn into_completion(self) -> serde_json::Value {
        let tool_calls: Vec<serde_json::Value> = self
            .tool_calls
            .into_iter()
            .filter(|t| !t.id.is_empty() || !t.name.is_empty() || !t.arguments.is_empty())
            .map(|t| {
                serde_json::json!({
                    "id": t.id,
                    "type": "function",
                    "function": { "name": t.name, "arguments": t.arguments }
                })
            })
            .collect();

        let mut message = serde_json::Map::new();
        message.insert("role".to_string(), serde_json::json!("assistant"));
        message.insert(
            "content".to_string(),
            if self.content.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::json!(self.content)
            },
        );
        // Reasoning stays out of `content` but is carried on the message so a
        // caller that resends assistant turns to the model can forward it (and
        // so a turn that only reasoned still surfaces its reasoning). Empty is
        // omitted so non-reasoning providers produce an unchanged shape.
        if !self.reasoning.is_empty() {
            message.insert(
                "reasoning_content".to_string(),
                serde_json::json!(self.reasoning),
            );
        }
        if !tool_calls.is_empty() {
            message.insert(
                "tool_calls".to_string(),
                serde_json::Value::Array(tool_calls),
            );
        }

        let mut choice = serde_json::Map::new();
        choice.insert("index".to_string(), serde_json::json!(0));
        choice.insert("message".to_string(), serde_json::Value::Object(message));
        choice.insert(
            "finish_reason".to_string(),
            self.finish_reason
                .map(|s| serde_json::json!(s))
                .unwrap_or(serde_json::Value::Null),
        );

        let mut completion = serde_json::Map::new();
        completion.insert(
            "choices".to_string(),
            serde_json::Value::Array(vec![serde_json::Value::Object(choice)]),
        );
        if let Some(u) = self.usage {
            completion.insert("usage".to_string(), u);
        }

        serde_json::Value::Object(completion)
    }
}

/// Drain every complete (newline-terminated) line from `buf` into `acc`,
/// leaving any trailing partial line buffered for the next chunk.
#[cfg(test)]
fn drain_complete_lines(
    buf: &mut String,
    acc: &mut SseAccumulator,
    events: &mpsc::UnboundedSender<StreamEvent>,
) {
    while let Some(nl) = buf.find('\n') {
        let line = buf[..nl].to_string();
        buf.drain(..=nl);
        acc.ingest_line(&line, events);
    }
}

/// Ingest a final, non-newline-terminated line left after the stream closes.
/// Providers may end with `data: {...}` and no trailing blank line / `[DONE]`;
/// without this the last chunk's finish_reason and tool-call args are dropped.
#[cfg(test)]
fn flush_trailing_line(
    buf: &str,
    acc: &mut SseAccumulator,
    events: &mpsc::UnboundedSender<StreamEvent>,
) {
    if !buf.trim().is_empty() {
        acc.ingest_line(buf, events);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn volatile_system_follows_the_stable_prompt_and_leaves_it_byte_stable() {
        let mut msgs = vec![json!({ "role": "user", "content": "hi" })];
        set_system_prompt(&mut msgs, "STABLE");
        insert_volatile_system(&mut msgs, "date + memory");
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[0]["content"], "STABLE");
        assert_eq!(msgs[1]["role"], "system");
        assert_eq!(msgs[1]["content"], "date + memory");
        assert_eq!(msgs[2]["role"], "user");

        // A second turn with different volatile content must not disturb node 0.
        let mut next = vec![
            json!({ "role": "user", "content": "hi" }),
            json!({ "role": "assistant", "content": "yo" }),
            json!({ "role": "user", "content": "again" }),
        ];
        set_system_prompt(&mut next, "STABLE");
        insert_volatile_system(&mut next, "different date");
        assert_eq!(next[0], msgs[0]);
    }

    #[test]
    fn compaction_summary_survives_a_system_prompt_update() {
        let marker = crate::core::agent::compaction::SUMMARY_MARKER;
        // The history a turn inherits after a mid-run compaction: previous
        // rebuilt system prompt, its volatile message, the summary, kept tail.
        let mut history = vec![
            json!({ "role": "system", "content": "OLD STABLE" }),
            json!({ "role": "system", "content": "old date" }),
            json!({ "role": "system", "content": format!("{marker}\n\ncondensed") }),
            json!({ "role": "assistant", "content": "kept" }),
            json!({ "role": "user", "content": "new question" }),
        ];
        let before = serde_json::to_string(&history[2]).unwrap();
        set_system_prompt(&mut history, "NEW STABLE");
        insert_volatile_system(&mut history, "new date");

        // The head keeps the bytes the previous request already sent: that is
        // the whole point of appending the update instead of rewriting node 0.
        assert_eq!(history[0]["content"], "OLD STABLE");
        assert_eq!(history[1]["content"], "new date");
        assert_eq!(
            serde_json::to_string(&history[2]).unwrap(),
            before,
            "nothing deletes by role, so the summary is untouched"
        );
        assert_eq!(history[3]["content"], "kept");
        assert_eq!(history[4]["content"], "new question");
        // The update is the newest system node, so it is the one the model
        // reads last rather than a duplicate of the head.
        let newest = history.last().unwrap();
        assert_eq!(newest["role"], "system");
        assert_eq!(newest["content"], "NEW STABLE");
    }

    #[test]
    fn volatile_system_stands_in_as_node_zero_when_no_stable_prompt() {
        let mut msgs = vec![json!({ "role": "user", "content": "hi" })];
        insert_volatile_system(&mut msgs, "date only");
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[0]["content"], "date only");
        assert_eq!(msgs[1]["role"], "user");
    }

    /// The system nodes a request carries, in the order the provider
    /// concatenates them.
    fn system_contents(messages: &[serde_json::Value]) -> Vec<String> {
        messages
            .iter()
            .filter(|m| m["role"] == "system")
            .map(|m| m["content"].as_str().unwrap().to_string())
            .collect()
    }

    fn serialized(messages: &[serde_json::Value]) -> Vec<String> {
        messages
            .iter()
            .map(|m| serde_json::to_string(m).unwrap())
            .collect()
    }

    /// The prompt is applied on every turn. A turn that changed nothing must
    /// therefore mutate nothing - otherwise every request invalidates its own
    /// prefix, which is the bug this writer exists to prevent.
    #[test]
    fn a_repeated_turn_mutates_nothing() {
        let mut conversation = vec![
            json!({ "role": "system", "content": "STABLE" }),
            json!({ "role": "system", "content": "date" }),
            json!({ "role": "user", "content": "hi" }),
            json!({ "role": "assistant", "content": "yo" }),
            json!({ "role": "user", "content": "again" }),
        ];
        let before = serde_json::to_string(&conversation).unwrap();

        set_system_prompt(&mut conversation, "STABLE");
        insert_volatile_system(&mut conversation, "date");

        assert_eq!(serde_json::to_string(&conversation).unwrap(), before);
    }

    /// A prompt that changed mid-session appends behind what was already sent.
    /// Every index the provider has seen keeps its exact bytes, so the reusable
    /// prefix survives the change instead of restarting at byte 0.
    #[test]
    fn a_changed_system_prompt_appends_behind_bytes_already_sent() {
        let mut conversation = vec![
            json!({ "role": "system", "content": "STABLE v1" }),
            json!({ "role": "system", "content": "date" }),
            json!({ "role": "user", "content": "hi" }),
            json!({ "role": "assistant", "content": "yo" }),
            json!({ "role": "user", "content": "go on" }),
        ];
        let sent = serialized(&conversation);

        set_system_prompt(&mut conversation, "STABLE v2");
        insert_volatile_system(&mut conversation, "date");

        assert_eq!(conversation.len(), sent.len() + 1, "one appended update");
        assert_eq!(
            serialized(&conversation)[..sent.len()],
            sent[..],
            "every index below the update is byte-identical"
        );
        assert_eq!(conversation.last().unwrap()["content"], "STABLE v2");

        // The next turn applies the same prompt again: no second copy of it.
        set_system_prompt(&mut conversation, "STABLE v2");
        insert_volatile_system(&mut conversation, "date");
        assert_eq!(conversation.len(), sent.len() + 1);
        assert_eq!(conversation.last().unwrap()["content"], "STABLE v2");
    }

    /// An appended update is not decoration: a request's system nodes
    /// concatenate in array order, so the newest prompt is the last system
    /// instruction the model reads. `genai_bridge` asserts the concatenated
    /// form the provider is actually handed.
    #[test]
    fn an_appended_update_is_the_last_system_node() {
        let mut conversation = vec![json!({ "role": "user", "content": "hi" })];
        set_system_prompt(&mut conversation, "STABLE v1");
        insert_volatile_system(&mut conversation, "date");
        set_system_prompt(&mut conversation, "STABLE v2");

        assert_eq!(
            system_contents(&conversation),
            vec!["STABLE v1", "date", "STABLE v2"]
        );
        // ...and the history it was appended behind is still there.
        assert_eq!(conversation[2]["content"], "hi");
    }

    /// Nothing is deleted by role: history another producer stored under
    /// `system` - a compaction summary, or a caller's own prompt - is not this
    /// writer's to remove.
    #[test]
    fn a_system_node_written_by_another_producer_is_not_deleted() {
        let mut conversation = vec![
            json!({ "role": "system", "content": "caller's own prompt" }),
            json!({ "role": "user", "content": "hi" }),
        ];
        set_system_prompt(&mut conversation, "STABLE");
        assert_eq!(conversation[0]["content"], "caller's own prompt");
        assert_eq!(
            system_contents(&conversation),
            vec!["caller's own prompt", "STABLE"]
        );
    }

    /// The empty-conversation case still places the prompt first, and the
    /// per-turn block follows it rather than displacing it.
    #[test]
    fn an_empty_conversation_places_the_prompt_first() {
        let mut messages: Vec<serde_json::Value> = Vec::new();
        set_system_prompt(&mut messages, "STABLE");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "STABLE");

        insert_volatile_system(&mut messages, "date");
        assert_eq!(messages[0]["content"], "STABLE");
        assert_eq!(messages[1]["content"], "date");
    }

    /// The layout both writers depend on: the stable prompt owns index 0, the
    /// per-turn block owns the slot behind it, and a new day rewrites only
    /// that slot.
    #[test]
    fn the_per_turn_block_never_displaces_the_stable_prompt() {
        let mut messages = vec![json!({ "role": "user", "content": "hi" })];
        set_system_prompt(&mut messages, "STABLE");
        for day in ["day 1", "day 2", "day 3"] {
            insert_volatile_system(&mut messages, day);
            assert_eq!(messages[0]["content"], "STABLE");
            assert_eq!(messages[1]["content"], day);
            assert_eq!(messages.len(), 3, "the block is replaced, not stacked");
        }
    }

    fn rendered(tool_name: &str) -> RenderedTool {
        (
            tool_name.to_string(),
            json!({
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": format!("does {tool_name}"),
                    "parameters": { "type": "object", "properties": {} }
                }
            }),
        )
    }

    fn advertised_names(tools: &[serde_json::Value]) -> Vec<String> {
        tools
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap().to_string())
            .collect()
    }

    /// A different process walks `servers.iter()` in a different order, so the
    /// cross-process assertion is made here by feeding the same configuration in
    /// two different orders - within one server too - and requiring the
    /// serialized array to come out byte-identical. In-process `HashMap`
    /// stability is never relied on.
    #[test]
    fn tool_array_is_byte_identical_whatever_order_the_servers_are_walked_in() {
        let one = vec![
            ("fs".to_string(), vec![rendered("write"), rendered("read")]),
            ("git".to_string(), vec![rendered("commit")]),
        ];
        let two = vec![
            ("git".to_string(), vec![rendered("commit")]),
            ("fs".to_string(), vec![rendered("read"), rendered("write")]),
        ];

        let (first, _) = assemble_tool_array(one);
        let (second, _) = assemble_tool_array(two);

        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
        // Sorted on (server, tool), not on listing order.
        assert_eq!(advertised_names(&first), ["read", "write", "commit"]);
    }

    /// Two servers exposing the same tool name is a pre-existing collision the
    /// array does not dedupe - but which server wins `tool_to_server` used to
    /// depend on iteration order, so the same call could route to either one
    /// across restarts. Sorting makes it the last server by name, always.
    #[test]
    fn a_tool_name_exposed_by_two_servers_routes_the_same_way_every_run() {
        let listings = |flipped: bool| {
            let fs = ("fs".to_string(), vec![rendered("search")]);
            let zed = ("zed".to_string(), vec![rendered("search")]);
            if flipped {
                vec![zed, fs]
            } else {
                vec![fs, zed]
            }
        };

        let (first, first_map) = assemble_tool_array(listings(false));
        let (second, second_map) = assemble_tool_array(listings(true));

        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
        assert_eq!(advertised_names(&first), ["search", "search"]);
        assert_eq!(first_map.get("search").unwrap(), "zed");
        assert_eq!(first_map, second_map);
    }

    #[test]
    fn tool_to_server_stays_consistent_with_the_reordered_array() {
        let (tools, tool_to_server) = assemble_tool_array(vec![
            ("git".to_string(), vec![rendered("commit")]),
            ("fs".to_string(), vec![rendered("read")]),
        ]);

        assert_eq!(advertised_names(&tools), ["read", "commit"]);
        assert_eq!(tool_to_server.get("read").unwrap(), "fs");
        assert_eq!(tool_to_server.get("commit").unwrap(), "git");
        assert_eq!(tool_to_server.len(), tools.len());
    }

    /// A listing timeout must not shrink the advertised array mid-session - the
    /// prefix would go cold on this turn and again when the server recovers.
    #[test]
    fn a_failed_listing_reuses_the_last_known_tools() {
        let mut cache = HashMap::new();
        let good = vec![("fs".to_string(), Some(vec![rendered("read")]))];
        let (before, _) = assemble_tool_array(reuse_last_good_listings(&mut cache, good));

        let timed_out = vec![("fs".to_string(), None)];
        let (after, mapping) = assemble_tool_array(reuse_last_good_listings(&mut cache, timed_out));

        assert_eq!(
            serde_json::to_string(&before).unwrap(),
            serde_json::to_string(&after).unwrap()
        );
        assert_eq!(mapping.get("read").unwrap(), "fs");
    }

    #[test]
    fn a_server_that_never_listed_successfully_is_omitted() {
        let mut cache = HashMap::new();
        let resolved = reuse_last_good_listings(&mut cache, vec![("fs".to_string(), None)]);
        let (tools, mapping) = assemble_tool_array(resolved);

        assert!(tools.is_empty());
        assert!(mapping.is_empty());
    }

    /// Removing a server changes the array exactly once: its cached listing goes
    /// with it, so re-adding it later can't resurrect a stale set of tools.
    #[test]
    fn removing_a_server_drops_its_cached_listing() {
        let mut cache = HashMap::new();
        reuse_last_good_listings(
            &mut cache,
            vec![
                ("fs".to_string(), Some(vec![rendered("read")])),
                ("git".to_string(), Some(vec![rendered("commit")])),
            ],
        );

        let resolved = reuse_last_good_listings(&mut cache, vec![("fs".to_string(), None)]);
        let (tools, _) = assemble_tool_array(resolved);

        assert_eq!(advertised_names(&tools), ["read"]);
        assert!(!cache.contains_key("git"));
    }

    /// A server that stops exposing a tool has to stop advertising it, and the
    /// cache must not resurrect it on a later hiccup: a stale cache would keep a
    /// removed tool in the array forever, so every turn would pay for the old
    /// prefix until the process restarted.
    #[test]
    fn a_relisting_replaces_the_cached_tools_instead_of_resurrecting_removed_ones() {
        let mut cache = HashMap::new();
        reuse_last_good_listings(
            &mut cache,
            vec![(
                "fs".to_string(),
                Some(vec![rendered("read"), rendered("write")]),
            )],
        );

        // `write` is no longer exposed by the server.
        let relisted = reuse_last_good_listings(
            &mut cache,
            vec![("fs".to_string(), Some(vec![rendered("read")]))],
        );
        let (tools, mapping) = assemble_tool_array(relisted);
        assert_eq!(advertised_names(&tools), ["read"]);
        assert!(!mapping.contains_key("write"));

        // A later hiccup reuses that listing, not the pre-removal one.
        let (after_hiccup, _) = assemble_tool_array(reuse_last_good_listings(
            &mut cache,
            vec![("fs".to_string(), None)],
        ));
        assert_eq!(advertised_names(&after_hiccup), ["read"]);
    }

    fn sink() -> (
        mpsc::UnboundedSender<StreamEvent>,
        mpsc::UnboundedReceiver<StreamEvent>,
    ) {
        mpsc::unbounded_channel()
    }
    fn provider_configs(map: &[(&str, &str)]) -> HashMap<String, ProviderConfig> {
        map.iter()
            .map(|(name, url)| {
                (
                    name.to_string(),
                    ProviderConfig {
                        provider: name.to_string(),
                        base_url: Some(url.to_string()),
                        models: vec![],
                        ..Default::default()
                    },
                )
            })
            .collect()
    }

    /// A `<provider>/<model>` id resolves to the bare model once the prefix
    /// names a configured provider - the body the upstream receives must not
    /// carry the selection qualifier.
    #[test]
    fn provider_prefix_is_stripped_when_it_names_a_provider() {
        let pc = provider_configs(&[("opencode", "https://opencode.ai/zen/go/v1")]);
        assert_eq!(
            strip_provider_prefix("opencode/gpt-5.6-luna", &pc),
            "gpt-5.6-luna"
        );
    }

    /// A slash inside a real model id is preserved when the leading segment is
    /// not a provider key, so org-scoped ids survive untouched.
    #[test]
    fn unknown_slash_prefix_is_left_alone() {
        let pc = provider_configs(&[("opencode", "https://opencode.ai/zen/go/v1")]);
        assert_eq!(
            strip_provider_prefix("mistral-technologies/mixtral", &pc),
            "mistral-technologies/mixtral"
        );
    }

    /// The gateway that serves `anthropic/claude-opus-5` lists it under that
    /// full id; the desktop inherit also contributes a provider keyed
    /// `anthropic`. Stripping there sends `claude-opus-5`, which the gateway
    /// answers with 404 "model not found in accessible providers".
    #[test]
    fn a_verbatim_listed_id_keeps_its_slash_despite_a_same_named_provider() {
        let mut pc = provider_configs(&[
            ("tokamak", "https://api.tokamak.sh/v1"),
            ("anthropic", "https://api.anthropic.com/v1"),
        ]);
        pc.get_mut("tokamak").unwrap().models = vec!["anthropic/claude-opus-5".to_string()];
        assert_eq!(
            strip_provider_prefix("anthropic/claude-opus-5", &pc),
            "anthropic/claude-opus-5"
        );
    }

    /// A bare model id (no slash) is returned unchanged.
    #[test]
    fn bare_model_id_is_unchanged() {
        let pc = provider_configs(&[("opencode", "https://opencode.ai/zen/go/v1")]);
        assert_eq!(strip_provider_prefix("gpt-5.6-luna", &pc), "gpt-5.6-luna");
    }
    /// `reqwest` prints only its own layer, so the cause chain is where the
    /// actual failure lives -- the whole point of `describe_request_error`.
    #[test]
    fn error_source_chain_lists_every_cause_and_collapses_repeats() {
        #[derive(Debug)]
        struct Err2(&'static str, Option<Box<Err2>>);
        impl std::fmt::Display for Err2 {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.0)
            }
        }
        impl std::error::Error for Err2 {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                self.1
                    .as_ref()
                    .map(|e| e.as_ref() as &(dyn std::error::Error + 'static))
            }
        }

        // The outermost message is printed by the caller, so the chain starts at
        // its first source; the repeated innermost layer collapses.
        let inner = Err2("connection refused", None);
        let middle = Err2("connection refused", Some(Box::new(inner)));
        let connect = Err2("tcp connect error", Some(Box::new(middle)));
        let outer = Err2("error sending request", Some(Box::new(connect)));
        assert_eq!(
            error_source_chain(&outer),
            vec![
                "tcp connect error".to_string(),
                "connection refused".to_string()
            ],
            "sources only, consecutive duplicates collapsed"
        );
        assert!(
            error_source_chain(&Err2("alone", None)).is_empty(),
            "no sources -> nothing to add"
        );
    }

    #[cfg(not(feature = "cli"))]
    /// The reported error must name the stage and carry the OS-level reason, not
    /// just the URL. Port 1 on loopback refuses without touching the network.
    #[tokio::test]
    async fn describe_request_error_names_the_stage_and_the_os_cause() {
        let err = Client::new()
            .post("http://127.0.0.1:1/v1/chat/completions")
            .body("{}")
            .send()
            .await
            .expect_err("loopback port 1 refuses");
        let msg = describe_request_error(&err);
        assert!(msg.starts_with("could not connect: "), "stage named: {msg}");
        assert!(msg.contains("caused by: "), "cause chain present: {msg}");
        assert!(
            msg.to_lowercase().contains("refused") || msg.to_lowercase().contains("connect"),
            "the OS reason survives: {msg}"
        );
    }

    #[cfg(not(feature = "cli"))]
    #[test]
    fn dropped_connection_is_recognised_from_the_cause_chain() {
        assert!(chain_indicates_dropped_connection(&[
            "client error (SendRequest)".to_string(),
            "connection error".to_string(),
            "Connection reset by peer (os error 104)".to_string(),
        ]));
        assert!(chain_indicates_dropped_connection(&[
            "connection closed before message completed".to_string()
        ]));
        assert!(
            !chain_indicates_dropped_connection(&[
                "dns error".to_string(),
                "failed to lookup address information".to_string()
            ]),
            "a name that does not resolve is not a dropped connection"
        );
        assert!(!chain_indicates_dropped_connection(&[]));
    }

    #[cfg(not(feature = "cli"))]
    /// A refused connect never reached the peer, so retrying it is safe; a
    /// timeout is excluded on purpose (retrying one doubles the wait).
    #[tokio::test]
    async fn a_refused_connect_is_retryable_but_a_timeout_is_not() {
        let refused = Client::new()
            .post("http://127.0.0.1:1/v1/chat/completions")
            .body("{}")
            .send()
            .await
            .expect_err("loopback port 1 refuses");
        assert!(is_retryable_send_error(&refused), "{refused}");

        // 10.255.255.1 is a reserved address that black-holes rather than
        // refusing, so the connect attempt hits the timeout instead.
        let timed_out = Client::builder()
            .connect_timeout(std::time::Duration::from_millis(50))
            .build()
            .expect("client")
            .post("http://10.255.255.1:81/v1/chat/completions")
            .body("{}")
            .send()
            .await
            .expect_err("black-holed address times out");
        if timed_out.is_timeout() {
            assert!(!is_retryable_send_error(&timed_out), "{timed_out}");
        }
    }

    /// The failure a long turn invites: the peer reclaims a keep-alive
    /// connection while tools run, and the next request is written into a socket
    /// that is already gone. One retry must carry the turn through, transparently
    /// -- the caller sees a normal completion, not an error.
    #[tokio::test]
    async fn a_dropped_first_connection_is_retried_and_the_turn_succeeds() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(async move {
            // First connection: read the request, then hang up without a byte of
            // response -- exactly what a reclaimed pooled connection looks like.
            let (mut first, _) = listener.accept().await.expect("first accept");
            let mut scratch = [0u8; 1024];
            let _ = first.read(&mut scratch).await;
            drop(first);

            // Second connection: a normal one-token SSE answer.
            let (mut second, _) = listener.accept().await.expect("second accept");
            let _ = second.read(&mut scratch).await;
            let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n\
                       data: [DONE]\n\n";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{sse}",
                sse.len()
            );
            let _ = second.write_all(resp.as_bytes()).await;
            let _ = second.flush().await;
        });

        let (tx, mut rx) = sink();
        let url = format!("http://{addr}/v1/chat/completions");
        let completion = stream_openai_chat_completions(
            &reqwest13::Client::new(),
            &url,
            &[],
            None,
            &json!({ "model": "m", "messages": [] }),
            &tx,
        )
        .await
        .expect("the retry carries the turn");

        assert_eq!(
            completion["choices"][0]["message"]["content"], "hi",
            "answer from the second connection: {completion}"
        );
        let mut tokens = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            if let StreamEvent::Token { text } = ev {
                tokens.push(text);
            }
        }
        assert_eq!(tokens, vec!["hi".to_string()], "streamed once, not twice");
        server.await.expect("server task");
    }
    #[tokio::test]
    async fn codex_oauth_request_matches_chatgpt_backend_contract() {
        use base64::Engine as _;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut bytes = vec![0u8; 16 * 1024];
            let read = socket.read(&mut bytes).await.expect("read");
            bytes.truncate(read);
            let response = "event: response.completed\n\
                data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n";
            let wire = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{response}",
                response.len()
            );
            socket.write_all(wire.as_bytes()).await.expect("response");
            String::from_utf8(bytes).expect("request is utf-8")
        });

        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"https://api.openai.com/auth":{"chatgpt_account_id":"account-123"}}"#);
        let token = format!("header.{payload}.signature");
        let converter =
            crate::core::server::converters::converter_for(Some("openai-responses"), true)
                .expect("converter");
        let (tx, _rx) = sink();
        stream_converted_chat_completions(
            &Client::new(),
            &format!("http://{addr}/chat/completions"),
            &[token],
            converter.as_ref(),
            &json!({
                "model": "gpt-5.6-terra",
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 128,
            }),
            &tx,
        )
        .await
        .expect("request");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(request.starts_with("POST /codex/responses HTTP/1.1\r\n"));
        assert!(lower.contains("\r\nchatgpt-account-id: account-123\r\n"));
        assert!(lower.contains("\r\nopenai-beta: responses=experimental\r\n"));
        assert!(lower.contains("\r\noriginator: jan\r\n"));
        let body: serde_json::Value =
            serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["store"], false);
        assert_eq!(body["include"], json!(["reasoning.encrypted_content"]));
        assert!(body.get("max_output_tokens").is_none());
    }

    /// A proxy in the environment breaks Jan and nothing else, and never shows up
    /// in the error. Names only: the values carry credentials.
    #[test]
    fn proxy_env_hint_names_set_variables_without_their_values() {
        static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var_os("HTTPS_PROXY");
        std::env::remove_var("HTTPS_PROXY");
        let before = proxy_env_hint();

        std::env::set_var("HTTPS_PROXY", "http://user:secret@proxy.internal:8080");
        let hint = proxy_env_hint().expect("a set proxy is reported");
        assert!(hint.contains("HTTPS_PROXY"), "names the variable: {hint}");
        assert!(!hint.contains("secret"), "never prints the value: {hint}");

        std::env::set_var("HTTPS_PROXY", "   ");
        assert_eq!(proxy_env_hint(), before, "a blank value is not a proxy");

        match prev {
            Some(v) => std::env::set_var("HTTPS_PROXY", v),
            None => std::env::remove_var("HTTPS_PROXY"),
        }
    }

    /// A model served both by a Jan desktop API server (reachable over HTTP) and
    /// by local engine descriptors (no base_url) must always resolve to the
    /// server. `HashMap` order is randomized, so the local entries outnumber the
    /// remote one here: without a deterministic preference this fails most runs.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn shared_model_id_resolves_to_the_reachable_provider() {
        let mut configs = HashMap::new();
        for local in ["llamacpp", "llamacpp-rs", "mlx", "engine-d", "engine-e"] {
            configs.insert(
                local.to_string(),
                ProviderConfig {
                    provider: local.into(),
                    base_url: None,
                    models: vec!["sentence-transformer-mini".into()],
                    ..Default::default()
                },
            );
        }
        configs.insert(
            "JanServer".to_string(),
            ProviderConfig {
                provider: "JanServer".into(),
                base_url: Some("http://127.0.0.1:1337/v1".into()),
                models: vec!["sentence-transformer-mini".into()],
                ..Default::default()
            },
        );

        let (url, _keys) =
            resolve_upstream_for_model("sentence-transformer-mini", Arc::new(Mutex::new(configs)))
                .await
                .expect("the API server provider is reachable");
        assert_eq!(url, "http://127.0.0.1:1337/v1/chat/completions");
    }

    /// When two reachable HTTP providers offer the same model id - one
    /// credentialed, one keyless - resolution must pick the credentialed one.
    /// Alphabetical order alone would route e.g. `gpt-5.6-luna` (carried by
    /// both `openai` and a signed-in `opencode`) to the keyless `openai` entry
    /// and fail with a 401 on the first request.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn shared_model_id_prefers_the_credentialed_provider() {
        let mut configs = HashMap::new();
        // Alphabetically first, but keyless - the old code would pick this.
        configs.insert(
            "openai".to_string(),
            ProviderConfig {
                provider: "openai".into(),
                base_url: Some("https://api.openai.com/v1".into()),
                models: vec!["gpt-5.6-luna".into()],
                ..Default::default()
            },
        );
        // Signed in, so it carries a key.
        configs.insert(
            "opencode".to_string(),
            ProviderConfig {
                provider: "opencode".into(),
                base_url: Some("https://opencode.ai/zen/v1".into()),
                api_key: Some("sk-opencode".into()),
                models: vec!["gpt-5.6-luna".into()],
                ..Default::default()
            },
        );

        let (url, keys) = resolve_upstream_for_model("gpt-5.6-luna", Arc::new(Mutex::new(configs)))
            .await
            .expect("the credentialed provider is selected");
        assert_eq!(url, "https://opencode.ai/zen/v1/chat/completions");
        assert_eq!(keys, vec!["sk-opencode"]);
    }

    /// The reporting path (price, context window, header label) must name the
    /// provider the request is routed to. A gateway listing a slashed id
    /// verbatim wins over a provider whose key happens to match the prefix, on
    /// both sides: reading the prefix first would price a Jan Router request
    /// against an `anthropic` entry that publishes neither window nor price.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn a_verbatim_listed_slashed_id_is_reported_against_the_gateway_that_serves_it() {
        let mut configs = provider_configs(&[
            ("tokamak", "https://api.tokamak.sh/v1"),
            ("anthropic", "https://api.anthropic.com/v1"),
        ]);
        configs.get_mut("tokamak").unwrap().models = vec!["anthropic/claude-opus-5".to_string()];

        assert_eq!(
            pick_provider_for_model("anthropic/claude-opus-5", &configs),
            Some("tokamak".to_string())
        );
        let (url, _) =
            resolve_upstream_for_model("anthropic/claude-opus-5", Arc::new(Mutex::new(configs)))
                .await
                .expect("the gateway listing the id serves it");
        assert_eq!(url, "https://api.tokamak.sh/v1/chat/completions");
    }

    /// A provider credentialed through the `api_keys` chain rather than a bare
    /// `api_key` is still the one routed to, so it must be the one reported:
    /// naming its keyless twin prices the request at the wrong rates and, on
    /// the window, against an entry that never published one.
    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn a_key_chain_credential_is_reported_like_it_is_routed() {
        let mut configs = provider_configs(&[
            ("aaa-keyless", "https://keyless.test/v1"),
            ("zzz-keychain", "https://keychain.test/v1"),
        ]);
        configs.get_mut("aaa-keyless").unwrap().models = vec!["shared-model".to_string()];
        let keychain = configs.get_mut("zzz-keychain").unwrap();
        keychain.models = vec!["shared-model".to_string()];
        keychain.api_keys = vec!["sk-chain".to_string()];

        assert_eq!(
            pick_provider_for_model("shared-model", &configs),
            Some("zzz-keychain".to_string())
        );
        let (url, _) = resolve_upstream_for_model("shared-model", Arc::new(Mutex::new(configs)))
            .await
            .expect("the credentialed provider is selected");
        assert_eq!(url, "https://keychain.test/v1/chat/completions");
    }

    /// A provider keyed by the model id (a local engine alias) is routable, so
    /// the reporting path must name it too rather than leaving the row
    /// unqualified and priced against whatever else lists the id.
    #[cfg(feature = "cli")]
    #[test]
    fn a_provider_keyed_by_the_model_id_is_named() {
        let configs = provider_configs(&[("my-local-model", "http://127.0.0.1:1337/v1")]);
        assert_eq!(
            pick_provider_for_model("my-local-model", &configs),
            Some("my-local-model".to_string())
        );
    }

    /// Holds the secret-store serialization guard, the temp data folder and the
    /// `JAN_DATA_FOLDER` restore together, so an async test can keep all three
    /// alive across `.await` without holding a bare lock guard over it.
    #[cfg(feature = "cli")]
    struct TempSecretStore {
        _guard: std::sync::MutexGuard<'static, ()>,
        previous: Option<String>,
        _dir: tempfile::TempDir,
    }

    #[cfg(feature = "cli")]
    impl TempSecretStore {
        fn new() -> Self {
            let guard = crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let dir = tempfile::tempdir().unwrap();
            let previous = std::env::var("JAN_DATA_FOLDER").ok();
            std::env::set_var("JAN_DATA_FOLDER", dir.path());
            crate::core::server::provider_secrets::force_file_secrets();
            Self {
                _guard: guard,
                previous,
                _dir: dir,
            }
        }
    }

    #[cfg(feature = "cli")]
    impl Drop for TempSecretStore {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var("JAN_DATA_FOLDER", value),
                None => std::env::remove_var("JAN_DATA_FOLDER"),
            }
        }
    }

    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn account_credentials_override_the_api_key_chain() {
        use crate::core::cli::auth::{Credential, CredentialStore, OAuthToken};

        let _secrets = TempSecretStore::new();
        CredentialStore::store(
            "openai",
            &Credential::OAuthToken(OAuthToken {
                access_token: "account-access".into(),
                refresh_token: Some("refresh".into()),
                expires_at: Some(1_800_000_000),
                token_type: "Bearer".into(),
                scopes: vec![],
            }),
        )
        .unwrap();
        let mut configs = HashMap::new();
        configs.insert(
            "openai".to_string(),
            ProviderConfig {
                provider: "openai".into(),
                base_url: Some("https://api.openai.com/v1".into()),
                api_key: Some("api-key".into()),
                models: vec!["account-model".into()],
                ..Default::default()
            },
        );

        let (url, keys) =
            resolve_upstream_for_model("account-model", Arc::new(Mutex::new(configs)))
                .await
                .unwrap();
        assert_eq!(url, "https://chatgpt.com/backend-api/chat/completions");
        assert_eq!(keys, vec!["account-access"]);
    }

    #[test]
    fn parse_messages_passes_multimodal_content_array_through() {
        let messages = json!([{
            "role": "user",
            "content": [
                { "type": "text", "text": "look" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
            ],
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["content"], messages[0]["content"]);
    }

    #[test]
    fn parse_messages_rejects_missing_content() {
        let messages = json!([{ "role": "user" }]);
        assert!(parse_openai_messages(&messages).is_err());
    }

    #[test]
    fn parse_messages_allows_null_content_assistant_tool_call_turn() {
        // An assistant tool-call turn (content: null + tool_calls) round-trips
        // through history and must be re-parseable on a follow-up request.
        let messages = json!([{
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": { "name": "write", "arguments": "{}" }
            }]
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["role"], "assistant");
        assert!(out[0]["content"].is_null());
        assert_eq!(out[0]["tool_calls"][0]["id"], "call_1");
    }

    #[test]
    fn parse_messages_preserves_tool_result_message() {
        // A role:tool result must keep its tool_call_id so the assistant/tool
        // pairing stays valid when the conversation is re-submitted.
        let messages = json!([{
            "role": "tool",
            "tool_call_id": "call_1",
            "content": "wrote file"
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["role"], "tool");
        assert_eq!(out[0]["tool_call_id"], "call_1");
        assert_eq!(out[0]["content"], "wrote file");
    }

    #[test]
    fn parse_messages_still_rejects_null_content_without_tool_calls() {
        // A plain assistant/user turn with null content is still invalid.
        let messages = json!([{ "role": "assistant", "content": null }]);
        assert!(parse_openai_messages(&messages).is_err());
    }

    #[test]
    fn repair_leaves_well_formed_conversation_untouched() {
        let mut messages = vec![
            json!({ "role": "user", "content": "hi" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "read", "arguments": "{}" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call_1", "content": "file contents" }),
            json!({ "role": "assistant", "content": "done" }),
        ];
        let before = messages.clone();
        assert_eq!(repair_dangling_tool_calls(&mut messages), 0);
        assert_eq!(messages, before);
    }

    #[test]
    fn repair_inserts_synthetic_result_for_a_fully_missing_tool_reply() {
        // An `ask`-style call interrupted before it ever produced a result --
        // e.g. the process was killed while the prompt was still pending.
        let mut messages = vec![
            json!({ "role": "user", "content": "make cat slide" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "toolu_ask",
                    "type": "function",
                    "function": { "name": "ask", "arguments": "{}" }
                }]
            }),
            json!({ "role": "user", "content": "next message, no reply ever recorded" }),
        ];
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "toolu_ask");
        assert!(messages[2]["content"]
            .as_str()
            .unwrap()
            .starts_with("ERROR"));
        assert_eq!(
            messages[3]["content"],
            "next message, no reply ever recorded"
        );
    }

    #[test]
    fn repair_fills_only_the_missing_id_in_a_multi_call_turn() {
        // Two tool calls in one turn; only one got a reply before the gap.
        let mut messages = vec![
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "call_a", "type": "function", "function": { "name": "read", "arguments": "{}" } },
                    { "id": "call_b", "type": "function", "function": { "name": "ask", "arguments": "{}" } },
                ]
            }),
            json!({ "role": "tool", "tool_call_id": "call_a", "content": "file contents" }),
        ];
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["tool_call_id"], "call_a");
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_b");
    }

    #[test]
    fn repair_handles_a_dangling_call_at_the_end_of_the_conversation() {
        // No trailing message at all after the unanswered tool call.
        let mut messages = vec![json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": { "name": "ask", "arguments": "{}" }
            }]
        })];
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["role"], "tool");
        assert_eq!(messages[1]["tool_call_id"], "call_1");
    }

    #[test]
    fn sanitize_leaves_valid_tool_calls_untouched() {
        // Well-formed arguments, plus the empty-object and absent-arguments
        // spellings providers use for a no-argument call.
        let mut messages = vec![
            json!({ "role": "user", "content": "hi" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "c1", "type": "function", "function": { "name": "read", "arguments": "{\"path\":\"a.rs\"}" } },
                    { "id": "c2", "type": "function", "function": { "name": "ls", "arguments": "{}" } },
                    { "id": "c3", "type": "function", "function": { "name": "now" } },
                ]
            }),
            json!({ "role": "tool", "tool_call_id": "c1", "content": "ok" }),
        ];
        let before = messages.clone();
        assert_eq!(drop_malformed_tool_calls(&mut messages), 0);
        assert_eq!(messages, before);
    }

    #[test]
    fn sanitize_drops_a_truncated_call_and_its_result() {
        // The wedging case: a stream cut mid-argument, persisted, then resent
        // on every later turn and 422'd by the upstream.
        let mut messages = vec![
            json!({ "role": "user", "content": "write the file" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_bad",
                    "type": "function",
                    "function": { "name": "write", "arguments": "{\"path\":\"a.rs\",\"content\":\"fn ma" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call_bad", "content": "stale" }),
            json!({ "role": "user", "content": "still there?" }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        // The empty assistant shell and the orphaned result are both gone.
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["content"], "write the file");
        assert_eq!(messages[1]["content"], "still there?");
    }

    #[test]
    fn sanitize_keeps_valid_siblings_of_a_poisoned_call() {
        let mut messages = vec![
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "ok", "type": "function", "function": { "name": "read", "arguments": "{\"path\":\"a\"}" } },
                    { "id": "bad", "type": "function", "function": { "name": "write", "arguments": "{\"path\":\"b" } },
                ]
            }),
            json!({ "role": "tool", "tool_call_id": "ok", "content": "contents" }),
            json!({ "role": "tool", "tool_call_id": "bad", "content": "stale" }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        let calls = messages[0]["tool_calls"].as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], "ok");
        // Only the poisoned call's result was dropped.
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["tool_call_id"], "ok");
    }

    #[test]
    fn sanitize_drops_a_call_without_an_id_and_the_result_that_cannot_carry_one() {
        // A call nothing can pair: its result goes out with an empty
        // `tool_call_id`, which is an orphan on every later turn.
        let mut messages = vec![
            json!({ "role": "user", "content": "run it" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "type": "function",
                    "function": { "name": "bash", "arguments": "{\"command\":\"ls\"}" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "", "content": "output" }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        // The unpaired call, the empty shell it left, and its result are gone.
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["content"], "run it");
    }

    #[test]
    fn orphan_tool_result_with_no_call_in_the_history_is_dropped() {
        // What the sanitizer cannot see: a result whose call was never in the
        // array at all (a caller's stored thread, a half-written replay). The
        // pass is the mirror of `repair_dangling_tool_calls`, which fills the
        // opposite gap.
        let mut messages = vec![
            json!({ "role": "user", "content": "carry on" }),
            json!({ "role": "tool", "tool_call_id": "", "content": "left behind" }),
            json!({ "role": "tool", "tool_call_id": "call_gone", "content": "also left behind" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "read", "arguments": "{}" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call_1", "content": "contents" }),
        ];
        assert_eq!(drop_orphaned_tool_results(&mut messages), 2);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2]["tool_call_id"], "call_1");
    }

    /// The full fixture matrix behind the plain-object invariant: what the
    /// provider sees as `arguments` must decode to a JSON object. A parse-only
    /// check is not enough -- the poisoned shapes here all parse cleanly and
    /// were accepted by the earlier code.
    #[test]
    fn arguments_must_decode_to_a_plain_object() {
        let call_with = |args: serde_json::Value| {
            json!({ "type": "function", "function": { "name": "edit", "arguments": args } })
        };
        let decodes_to_object = json!("{\"path\":\"a.rs\",\"content\":\"fn main() {}\"}");
        assert!(arguments_are_executable(&call_with(decodes_to_object)));
        // A plain object in the field is off-wire but semantically valid.
        assert!(arguments_are_executable(&call_with(json!({ "path": "a.rs" }))));
        // Absent, null, and empty are the "no arguments" spelling.
        assert!(arguments_are_executable(&call_with(json!(""))));
        assert!(arguments_are_executable(&call_with(json!("   "))));
        assert!(arguments_are_executable(&call_with(serde_json::Value::Null)));
        assert!(arguments_are_executable(&json!({ "type": "function", "function": { "name": "now" } })));

        // The reported poison: a JSON string literal whose decoding is another
        // string. JSON.parse succeeds; typeof parsed === "string". The same
        // family covers every other scalar, arrays, and truncated JSON.
        assert!(!arguments_are_executable(&call_with(json!("\"{\\\"path\\\":\\\"a.rs\\\"}\""))));
        assert!(!arguments_are_executable(&call_with(json!("[1,2,3]"))));
        assert!(!arguments_are_executable(&call_with(json!("42"))));
        assert!(!arguments_are_executable(&call_with(json!("true"))));
        assert!(!arguments_are_executable(&call_with(json!("null"))));
        assert!(!arguments_are_executable(&call_with(json!("{\"path\":\"a.rs\",\"co"))));
        // Off-wire non-string shapes: lists and scalars are poison.
        assert!(!arguments_are_executable(&call_with(json!(["a"]))));
        assert!(!arguments_are_executable(&call_with(json!(7))));
    }

    #[test]
    fn sanitize_drops_the_double_encoded_argument_case() {
        // The reported incident: the model emitted a tool call whose arguments
        // were a JSON string literal containing JSON. It parses, so the call
        // survived, and the upstream rejected every request carrying it.
        let mut messages = vec![
            json!({ "role": "user", "content": "edit the file" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_edit",
                    "type": "function",
                    "function": { "name": "edit", "arguments": "\"{\\\"path\\\": \\\"a.rs\\\"}\"" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call_edit", "content": "(arguments incomplete; not executed)" }),
            json!({ "role": "user", "content": "hello?" }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["content"], "edit the file");
        assert_eq!(messages[1]["content"], "hello?");
    }

    #[test]
    fn sanitize_preserves_assistant_text_when_all_calls_are_dropped() {
        let mut messages = vec![json!({
            "role": "assistant",
            "content": "I'll write that file now.",
            "tool_calls": [{
                "id": "bad",
                "type": "function",
                "function": { "name": "write", "arguments": "{\"content\":\"trunc" }
            }]
        })];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["content"], "I'll write that file now.");
        assert!(messages[0].get("tool_calls").is_none());
    }

    #[test]
    fn sanitize_then_dangling_repair_leaves_a_sendable_conversation() {
        // The two passes compose the way the orchestrator runs them: the
        // poisoned call goes away, and the surviving call that lost its result
        // gets the synthetic error reply rather than being left dangling.
        let mut messages = vec![
            json!({ "role": "user", "content": "go" }),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "keep", "type": "function", "function": { "name": "read", "arguments": "{}" } },
                    { "id": "poison", "type": "function", "function": { "name": "write", "arguments": "{\"a\":" } },
                ]
            }),
        ];
        assert_eq!(drop_malformed_tool_calls(&mut messages), 1);
        assert_eq!(repair_dangling_tool_calls(&mut messages), 1);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "keep");
        // Every remaining call id has exactly one matching result.
        let ids: Vec<&str> = messages[1]["tool_calls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["keep"]);
    }

    #[test]
    fn detects_provider_context_overflow_bodies() {
        assert!(is_context_overflow_body(
            "{\"error\":{\"code\":\"context_length_exceeded\"}}"
        ));
        assert!(is_context_overflow_body(
            "This model's maximum context length is 8192 tokens"
        ));
        assert!(is_context_overflow_body(
            "prompt is too long: 210000 tokens > 200000"
        ));
        assert!(is_context_overflow_body(
            "the request exceeds the available context size"
        ));
        assert!(is_context_overflow_body(
            "{\"error\":{\"code\":400,\"message\":\"request (4267 tokens) exceeds the available \
             context size (4096 tokens), try increasing it\",\"type\":\"exceed_context_size_error\",\
             \"n_prompt_tokens\":4267,\"n_ctx\":4096}}"
        ));
        assert!(!is_context_overflow_body("invalid api key"));
        assert!(!is_context_overflow_body("rate limit exceeded"));
    }

    #[test]
    fn overflow_marker_round_trips() {
        let err = format!("[{CONTEXT_OVERFLOW_MARKER}] Upstream returned HTTP 400: ...");
        assert!(is_context_overflow_error(&err));
        assert!(!is_context_overflow_error(
            "Upstream returned HTTP 500: boom"
        ));
    }

    /// The shapes strict endpoints actually return, plus the two ways a false
    /// positive would arise: an error that names the field without rejecting it,
    /// and a rejection of some other field.
    #[test]
    fn detects_a_rejected_reasoning_content_field() {
        for body in [
            "Upstream returned HTTP 400: {\"error\":{\"message\":\"'messages.1' : for 'role':'assistant' the following must be satisfied[('messages.1.reasoning_content' : property 'reasoning_content' is unsupported)]\"}}",
            "Upstream returned HTTP 400: Unrecognized request argument supplied: reasoning_content",
            "Upstream returned HTTP 400: body.messages.1.reasoning_content: Extra inputs are not permitted",
            "Upstream returned HTTP 400: Invalid value for 'reasoning_content'",
        ] {
            assert!(is_reasoning_field_error(body), "missed: {body}");
        }
        assert!(!is_reasoning_field_error(
            "Upstream returned HTTP 500: reasoning_content was truncated"
        ));
        assert!(!is_reasoning_field_error(
            "Upstream returned HTTP 400: property 'audio' is unsupported"
        ));
    }

    /// A resent assistant turn keeps its `reasoning_content` through the message
    /// normalizer. Local llama.cpp templates with `preserve_thinking` re-emit
    /// prior reasoning from this field; dropping it would shrink earlier turns
    /// and force the KV-cache prefix to be reprocessed.
    #[test]
    fn parse_messages_preserves_assistant_reasoning_content() {
        let messages = json!([{
            "role": "assistant",
            "content": "the answer",
            "reasoning_content": "the thinking"
        }]);
        let out = parse_openai_messages(&messages).unwrap();
        assert_eq!(out[0]["content"], "the answer");
        assert_eq!(out[0]["reasoning_content"], "the thinking");
    }

    /// Only assistant turns carry reasoning back. A stray field on another role
    /// is not part of the protocol, so it is dropped rather than forwarded.
    #[test]
    fn parse_messages_drops_reasoning_on_non_assistant_roles() {
        let messages = json!([
            { "role": "user", "content": "q", "reasoning_content": "nope" },
            { "role": "assistant", "content": "a" },
        ]);
        let out = parse_openai_messages(&messages).unwrap();
        assert!(out[0].get("reasoning_content").is_none());
        assert!(
            out[1].get("reasoning_content").is_none(),
            "an assistant turn with no reasoning stays unchanged"
        );
    }

    /// Providers that inline `<think>` tags in `content` (no reasoning_content
    /// field) keep streaming through Token untouched: the tag-stripping
    /// fallback lives in the consumers.
    #[test]
    fn inline_think_tags_in_content_pass_through_as_tokens() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "content": "<think>hmm</think>answer" } }] })
                .to_string(),
            &tx,
        );
        drop(tx);
        let mut tokens = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            match ev {
                StreamEvent::Token { text } => tokens.push(text),
                StreamEvent::Reasoning { .. } => panic!("no native reasoning here"),
                _ => {}
            }
        }
        assert_eq!(tokens, vec!["<think>hmm</think>answer"]);
    }

    #[test]
    fn reassembles_tool_call_arguments_split_across_deltas() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_1", "function": { "name": "search", "arguments": "{\"q\":" } }
            ] } }] })
            .to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": "\"rust\"}" } }
            ] } }] })
            .to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }],
                     "usage": { "total_tokens": 12 } })
            .to_string(),
            &tx,
        );

        let completion = acc.into_completion();
        let tc = &completion["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(tc["id"], "call_1");
        assert_eq!(tc["function"]["name"], "search");
        assert_eq!(tc["function"]["arguments"], "{\"q\":\"rust\"}");
        assert_eq!(completion["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(completion["usage"]["total_tokens"], 12);
    }

    #[test]
    fn emits_tool_call_started_once_when_id_and_name_first_known() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        // First delta carries id + name; arguments arrive later, split across
        // deltas -- the in-progress signal must fire on this first delta only.
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_1", "function": { "name": "write", "arguments": "{\"path\":" } }
            ] } }] })
            .to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": "\"a.txt\"}" } }
            ] } }] })
            .to_string(),
            &tx,
        );

        drop(tx);
        let started: Vec<(String, String)> = std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|ev| match ev {
                StreamEvent::ToolCallStarted { id, name } => Some((id, name)),
                _ => None,
            })
            .collect();
        assert_eq!(started, vec![("call_1".to_string(), "write".to_string())]);
    }

    #[test]
    fn emits_tool_call_started_per_parallel_call() {
        let (tx, mut rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_a", "function": { "name": "read", "arguments": "" } },
                { "index": 1, "id": "call_b", "function": { "name": "grep", "arguments": "" } }
            ] } }] })
            .to_string(),
            &tx,
        );

        drop(tx);
        let mut names: Vec<String> = std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|ev| match ev {
                StreamEvent::ToolCallStarted { name, .. } => Some(name),
                _ => None,
            })
            .collect();
        names.sort();
        assert_eq!(names, vec!["grep".to_string(), "read".to_string()]);
    }

    #[test]
    fn captures_mid_stream_error_object_with_type_prefix() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(
            &json!({ "choices": [{ "delta": { "content": "partial" } }] }).to_string(),
            &tx,
        );
        acc.ingest(
            &json!({ "error": { "message": "upstream exploded", "type": "server_error" } })
                .to_string(),
            &tx,
        );
        assert_eq!(
            acc.error.as_deref(),
            Some("server_error: upstream exploded")
        );
    }

    #[test]
    fn mid_stream_error_falls_back_to_message_without_type() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest(&json!({ "error": { "message": "boom" } }).to_string(), &tx);
        assert_eq!(acc.error.as_deref(), Some("boom"));
    }

    #[test]
    fn ignores_done_sentinel_and_malformed_lines() {
        let (tx, _rx) = sink();
        let mut acc = SseAccumulator::default();
        acc.ingest("[DONE]", &tx);
        acc.ingest("not json", &tx);
        let completion = acc.into_completion();
        assert!(completion["choices"][0]["message"]["content"].is_null());
    }

    /// Feed arbitrary byte chunks through the real buffering path, then close.
    fn feed_and_close(
        chunks: &[&str],
        events: &mpsc::UnboundedSender<StreamEvent>,
    ) -> serde_json::Value {
        let mut buf = String::new();
        let mut acc = SseAccumulator::default();
        for c in chunks {
            buf.push_str(c);
            drain_complete_lines(&mut buf, &mut acc, events);
        }
        flush_trailing_line(&buf, &mut acc, events);
        acc.into_completion()
    }

    #[test]
    fn flushes_final_line_without_trailing_newline() {
        let (tx, _rx) = sink();
        // Provider closes right after the final data line: no `\n`, no `[DONE]`.
        let final_chunk = json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }] });
        let completion = feed_and_close(
            &[
                "data: ",
                &json!({ "choices": [{ "delta": { "content": "hi" } }] }).to_string(),
                "\n\ndata: ",
                &final_chunk.to_string(),
            ],
            &tx,
        );

        assert_eq!(completion["choices"][0]["message"]["content"], "hi");
        assert_eq!(completion["choices"][0]["finish_reason"], "tool_calls");
    }

    #[test]
    fn newline_terminated_stream_still_parses() {
        let (tx, _rx) = sink();
        let completion = feed_and_close(
            &[
                &format!(
                    "data: {}\n\n",
                    json!({ "choices": [{ "delta": { "content": "ok" }, "finish_reason": "stop" }] })
                ),
                "data: [DONE]\n\n",
            ],
            &tx,
        );
        assert_eq!(completion["choices"][0]["message"]["content"], "ok");
        assert_eq!(completion["choices"][0]["finish_reason"], "stop");
    }

    /// The converted-stream decode path: a native (non-chat/completions) SSE
    /// event is run through its [`UpstreamConverter::convert_stream_event`],
    /// and each produced chat-shaped payload is fed into the same
    /// [`SseAccumulator`] the OpenAI path uses, so `StreamEvent`s come out
    /// identical. This mirrors `consume_converted_sse` (minus the live HTTP).
    #[test]
    fn converted_stream_emits_chat_shaped_events() {
        use crate::core::server::converters::{AnthropicMessagesConverter, SseEvent, StreamState};

        let (tx, mut rx) = sink();
        let converter = AnthropicMessagesConverter::new();
        let mut state = StreamState::default();
        let mut acc = SseAccumulator::default();

        // A single Anthropic `message_start` event -> role header chunk, then a
        // `content_block_delta` with text -> token chunk, then `message_stop`.
        let events = [
            SseEvent {
                event: "message_start".into(),
                data: json!({
                    "type": "message_start",
                    "message": { "id": "msg_1", "model": "claude-sonnet-4" }
                })
                .to_string(),
            },
            SseEvent {
                event: "content_block_delta".into(),
                data: json!({
                    "type": "content_block_delta",
                    "delta": { "type": "text_delta", "text": "hi" }
                })
                .to_string(),
            },
            SseEvent {
                event: "message_stop".into(),
                data: json!({ "type": "message_stop" }).to_string(),
            },
        ];
        for event in &events {
            for payload in converter.convert_stream_event(event, &mut state) {
                acc.ingest(&payload, &tx);
            }
        }

        // Exactly one Token event with the translated text.
        let mut tokens = Vec::new();
        while let Ok(StreamEvent::Token { text }) = rx.try_recv() {
            tokens.push(text);
        }
        assert!(
            tokens.contains(&"hi".to_string()),
            "token delta decoded: {tokens:?}"
        );

        let completion = acc.into_completion();
        assert_eq!(completion["choices"][0]["message"]["content"], "hi");
    }
}
