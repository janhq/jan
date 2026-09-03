//! Analytics identity for the headless `jan` CLI.
//!
//! Holds the persisted anonymous install id (analogous to the desktop's
//! `nonce_seed` session, see `core::updater::session`) and the `Jan-Agent/...`
//! user agent. Both are consumed by `updater::fetch_manifest`, which checks for
//! updates through the analytics proxy so that the check itself is the usage
//! record -- the same way a desktop update check is recorded. Nothing here
//! sends a request of its own.
//!
//! `JAN_CLI_NO_UPDATE_CHECK` opts out: `updater` then skips the proxy entirely
//! and reads the manifest straight from the CDN, so no identity is sent.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Default, Deserialize, Serialize)]
struct TelemetryState {
    #[serde(default)]
    install_id: Option<String>,
}

fn state_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".jan").join("cli_telemetry.json"))
}

fn load_state(path: &Path) -> TelemetryState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_state(path: &Path, state: &TelemetryState) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(raw) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(path, raw);
    }
}

/// The stable per-install id used as the analytics distinct id, generated on
/// first use and persisted to `~/.jan/cli_telemetry.json`. `None` when there is
/// no home directory to persist to -- the caller then skips the proxy rather
/// than inventing a fresh id per run, which would count one install as many.
pub(super) fn install_id() -> Option<String> {
    let path = state_path()?;
    let mut state = load_state(&path);
    if let Some(id) = state.install_id.clone() {
        return Some(id);
    }

    let id = Uuid::new_v4().to_string();
    state.install_id = Some(id.clone());
    save_state(&path, &state);
    Some(id)
}

// "Jan Agent", not "Jan": lets the analytics backend tell this apart from a
// desktop client, which sends "Jan/{version} (...)" (see
// `custom_updater::build_user_agent`) -- both share the same version number,
// so the client name is the only distinguishing signal in the request.
pub(super) fn user_agent(version: &str) -> String {
    format!(
        "Jan-Agent/{} ({}; {})",
        version,
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_has_no_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cli_telemetry.json");
        let state = load_state(&path);
        assert!(state.install_id.is_none());
    }

    #[test]
    fn state_roundtrips_through_save_and_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cli_telemetry.json");
        let state = TelemetryState {
            install_id: Some("abc-123".to_string()),
        };
        save_state(&path, &state);
        assert_eq!(load_state(&path).install_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn existing_install_ids_survive_the_ping_field_going_away() {
        // Files written by the previous ping-based telemetry carry an extra
        // `last_ping_unix`. Dropping the field must not orphan the install id,
        // or every existing install would be counted as new.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cli_telemetry.json");
        std::fs::write(
            &path,
            r#"{"install_id":"legacy-id","last_ping_unix":1787720989}"#,
        )
        .unwrap();
        assert_eq!(load_state(&path).install_id.as_deref(), Some("legacy-id"));
    }

    #[test]
    fn user_agent_names_the_agent_not_the_desktop() {
        let ua = user_agent("0.8.4-37");
        assert!(ua.starts_with("Jan-Agent/0.8.4-37 ("), "{ua}");
    }
}
