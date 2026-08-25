//! The desktop's persistent subscriber to the worker's `/models/sse` feed.
//!
//! Distinct from the per-load listener in `commands::spawn_load_progress_listener`,
//! which exists only for the duration of one load: this one lives as long as
//! the worker and reports transitions Jan did not ask for. An LRU eviction
//! under `models_max` is the case that matters -- Jan flips `activeModels` off
//! for unloads it requested itself, so without this the UI keeps showing a
//! model the engine has already dropped.

use tauri::{Emitter, Runtime};

/// Emitted per unload, with the frontend payload `LlamacppOomListener` reads.
const UNLOADED_EVENT: &str = "llamacpp-model-unloaded";

/// Pause before re-subscribing after the stream ends. The worker outlives any
/// single connection, so a dropped stream is reconnected rather than treated as
/// the end of the feed.
const RECONNECT_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

/// Consecutive failed connects before giving up. Bounded so a worker that is
/// gone (or too old for the endpoint) costs a handful of attempts rather than a
/// task reconnecting forever.
const MAX_CONSECUTIVE_FAILURES: u32 = 5;

#[derive(serde::Serialize, Clone)]
struct UnloadPayload {
    model: String,
    exit_code: Option<i64>,
}

/// Subscribes until aborted. The caller owns the handle (`LlamacppState::unload_watcher`)
/// and aborts it when the worker stops.
pub fn spawn<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    port: u16,
    api_key: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut failures = 0u32;
        while failures < MAX_CONSECUTIVE_FAILURES {
            match subscribe_once(&app_handle, port, &api_key).await {
                Ok(()) => failures = 0,
                Err(e) => {
                    failures += 1;
                    log::debug!("/models/sse watcher could not subscribe ({failures}): {e}");
                }
            }
            tokio::time::sleep(RECONNECT_DELAY).await;
        }
        log::warn!(
            "giving up on /models/sse after {MAX_CONSECUTIVE_FAILURES} failed attempts; \
             evictions will not be reported to the UI until the engine restarts"
        );
    })
}

/// One connection, streamed to its end. `Ok` means the feed was reached, so a
/// stream that later drops does not count against the failure budget.
async fn subscribe_once<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    port: u16,
    api_key: &str,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let resp = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/models/sse"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("/models/sse returned {}", resp.status()));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let Ok(bytes) = chunk else { break };
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buf.find("\n\n") {
            let block: String = buf.drain(..pos + 2).collect();
            if let Some(payload) = parse_unload(&block) {
                if let Err(e) = app_handle.emit(UNLOADED_EVENT, payload) {
                    log::warn!("emit {UNLOADED_EVENT} failed: {e}");
                }
            }
        }
    }
    Ok(())
}

/// The `unloaded` transition out of one SSE block, or None for anything else.
/// Unlike the load listener this is model-agnostic: it forwards every model's
/// unload, since it has no particular load to watch.
fn parse_unload(block: &str) -> Option<UnloadPayload> {
    for line in block.lines() {
        let data = line
            .strip_prefix("data: ")
            .or_else(|| line.strip_prefix("data:"))?;
        let json: serde_json::Value = serde_json::from_str(data).ok()?;
        if json.get("event").and_then(|v| v.as_str()) != Some("status_change") {
            continue;
        }
        let data = json.get("data")?;
        if data.get("status").and_then(|v| v.as_str()) != Some("unloaded") {
            continue;
        }
        return Some(UnloadPayload {
            model: json.get("model")?.as_str()?.to_string(),
            exit_code: data.get("exit_code").and_then(|v| v.as_i64()),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::events::{ModelEvent, Transition};

    fn frame(model: &str, status: Transition) -> String {
        ModelEvent {
            model: model.to_string(),
            status,
        }
        .to_sse_frame()
    }

    #[test]
    fn reads_an_unload_the_engine_emitted() {
        let p = parse_unload(&frame("qwen", Transition::Unloaded { exit_code: 0 }))
            .expect("an unload");
        assert_eq!(p.model, "qwen");
        assert_eq!(p.exit_code, Some(0));
    }

    // A failed load is also an unload, and the UI has to drop the model either
    // way -- it never became usable.
    #[test]
    fn a_failed_load_is_forwarded_too() {
        let p = parse_unload(&frame("qwen", Transition::Unloaded { exit_code: 1 }))
            .expect("an unload");
        assert_eq!(p.exit_code, Some(1));
    }

    #[test]
    fn other_transitions_are_ignored() {
        assert!(parse_unload(&frame("qwen", Transition::Loading)).is_none());
        assert!(parse_unload(&frame("qwen", Transition::Loaded)).is_none());
    }

    #[test]
    fn malformed_blocks_are_ignored() {
        assert!(parse_unload("data: not json\n\n").is_none());
        assert!(parse_unload(": keepalive\n\n").is_none());
        assert!(parse_unload("").is_none());
    }
}
