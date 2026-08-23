//! The `/models/sse` feed: model lifecycle transitions, pushed as they happen.
//!
//! Jan's desktop side subscribes to this for the whole of a load
//! (`commands::spawn_load_progress_listener`) and needs it for one thing
//! polling `GET /models` cannot give it: a *definitive* failure. A snapshot can
//! carry a stale `failed` flag from an earlier attempt or an eviction, whereas
//! an `unloaded` event arriving after this attempt's `loading` on the same
//! ordered stream is this attempt's outcome. Without the feed the load waits
//! out its full timeout instead of erroring.
//!
//! The wire shape is upstream's, because that is what the desktop parses,
//! including the `progress` object: `server_context` reports real load
//! progress through `set_state_callback` (server-context.cpp), and the shim
//! forwards its `{stages, current, value}` payload verbatim, so the desktop's
//! `parse_load_progress_event` needs no separate shape to understand. This is
//! *load* progress, not the download fraction upstream puts there -- these
//! models are already on disk.

use tokio::sync::broadcast;

/// Room for a burst (a reload evicting several models) without a subscriber
/// that is mid-write missing the transition it was waiting for.
const CHANNEL_CAPACITY: usize = 64;

/// A lifecycle *transition*, as opposed to `registry::ModelStatus`, which is
/// the steady state `GET /models` reports.
#[derive(Debug, Clone, PartialEq)]
pub enum Transition {
    Loading,
    /// A fraction of the way through loading, as reported by the engine. The
    /// payload is llama.cpp's own (`stages`, `current`, `value`) and is passed
    /// through rather than re-modelled, since only the desktop reads it.
    LoadProgress(serde_json::Value),
    Loaded,
    /// `exit_code` is 0 for a deliberate unload or an eviction and nonzero for
    /// a failed load, which is how upstream marks one (`is_failed`) and how the
    /// desktop tells the two apart.
    Unloaded { exit_code: i32 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelEvent {
    pub model: String,
    pub status: Transition,
}

impl ModelEvent {
    /// One SSE frame, terminator included.
    pub fn to_sse_frame(&self) -> String {
        let data = match &self.status {
            Transition::Loading => serde_json::json!({ "status": "loading" }),
            // Still `loading`: the status is the state, `progress` is how far
            // into it. The desktop keys the percentage off the latter alone.
            Transition::LoadProgress(progress) => {
                serde_json::json!({ "status": "loading", "progress": progress })
            }
            Transition::Loaded => serde_json::json!({ "status": "loaded" }),
            Transition::Unloaded { exit_code } => {
                serde_json::json!({ "status": "unloaded", "exit_code": exit_code })
            }
        };
        let payload = serde_json::json!({
            "model": self.model,
            "event": "status_change",
            "data": data,
        });
        format!("data: {payload}\n\n")
    }
}

/// Fan-out to every open `/models/sse` connection.
///
/// A send with no subscribers is not an error here: the engine runs whether or
/// not anyone is watching, so `emit` discards that case rather than logging it
/// once per transition.
#[derive(Clone)]
pub struct EventBus(broadcast::Sender<ModelEvent>);

impl EventBus {
    pub fn new() -> Self {
        Self(broadcast::channel(CHANNEL_CAPACITY).0)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ModelEvent> {
        self.0.subscribe()
    }

    pub fn emit(&self, model: &str, status: Transition) {
        let _ = self.0.send(ModelEvent {
            model: model.to_string(),
            status,
        });
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(event: &ModelEvent) -> serde_json::Value {
        let frame = event.to_sse_frame();
        assert!(frame.ends_with("\n\n"), "{frame:?}");
        let data = frame
            .trim_end()
            .strip_prefix("data: ")
            .expect("an SSE data line");
        serde_json::from_str(data).expect("valid json")
    }

    // The desktop's `parse_load_status_change` matches on these exact keys, so
    // the shape is the contract, not an implementation detail.
    #[test]
    fn frames_carry_the_fields_the_desktop_parses() {
        let v = parsed(&ModelEvent {
            model: "qwen".into(),
            status: Transition::Loading,
        });
        assert_eq!(v["model"], "qwen");
        assert_eq!(v["event"], "status_change");
        assert_eq!(v["data"]["status"], "loading");

        let v = parsed(&ModelEvent {
            model: "qwen".into(),
            status: Transition::Loaded,
        });
        assert_eq!(v["data"]["status"], "loaded");
    }

    // A failed load and an eviction are the same status; only the exit code
    // separates them, and the desktop only fails a load on a nonzero one.
    #[test]
    fn an_unload_reports_its_exit_code() {
        let v = parsed(&ModelEvent {
            model: "qwen".into(),
            status: Transition::Unloaded { exit_code: 1 },
        });
        assert_eq!(v["data"]["status"], "unloaded");
        assert_eq!(v["data"]["exit_code"], 1);

        let v = parsed(&ModelEvent {
            model: "qwen".into(),
            status: Transition::Unloaded { exit_code: 0 },
        });
        assert_eq!(v["data"]["exit_code"], 0);
    }

    #[test]
    fn a_model_id_needing_escaping_stays_valid_json() {
        let v = parsed(&ModelEvent {
            model: "weird \"name\"\n".into(),
            status: Transition::Loaded,
        });
        assert_eq!(v["model"], "weird \"name\"\n");
    }

    #[tokio::test]
    async fn every_subscriber_sees_the_transition() {
        let bus = EventBus::new();
        let mut a = bus.subscribe();
        let mut b = bus.subscribe();

        bus.emit("qwen", Transition::Loading);

        assert_eq!(a.recv().await.unwrap().status, Transition::Loading);
        assert_eq!(b.recv().await.unwrap().status, Transition::Loading);
    }

    // Emission must never depend on anyone listening.
    #[test]
    fn emitting_with_no_subscribers_is_not_an_error() {
        EventBus::new().emit("qwen", Transition::Loaded);
    }

    // The desktop reads the percentage out of `data.progress`, keyed on the
    // same field names llama.cpp's own callback uses.
    #[test]
    fn a_progress_frame_carries_the_engines_payload_verbatim() {
        let v = parsed(&ModelEvent {
            model: "qwen".into(),
            status: Transition::LoadProgress(serde_json::json!({
                "stages": ["text_model", "mmproj_model"],
                "current": "text_model",
                "value": 0.42,
            })),
        });
        assert_eq!(v["data"]["status"], "loading");
        assert_eq!(v["data"]["progress"]["current"], "text_model");
        assert_eq!(v["data"]["progress"]["value"], 0.42);
        assert_eq!(v["data"]["progress"]["stages"][1], "mmproj_model");
    }

}
