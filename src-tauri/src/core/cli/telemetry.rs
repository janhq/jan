//! Anonymous usage ping for the headless `jan` CLI.
//!
//! Reuses the desktop's HMAC-signed update-check endpoint purely as a usage
//! counter: once per 24h, fires a signed request carrying the CLI version,
//! OS/arch, and a persisted anonymous install id (analogous to the desktop's
//! `nonce_seed` session, see `core::updater::session`). The `User-Agent` is
//! `Jan-Agent/...`, not `Jan/...`, so this is distinguishable server-side from
//! a desktop update check. Shares the update check's opt-out
//! (`JAN_CLI_NO_UPDATE_CHECK`) and its silent-failure philosophy: a dropped
//! ping must never print anything or affect startup.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::core::updater::custom_updater::SECRET_KEY;
use crate::core::updater::hmac_client::SignedRequestHeaders;

const PING_ENDPOINT: &str = "https://apps.jan.ai/update-check";
const PING_INTERVAL_SECS: u64 = 24 * 60 * 60;
const PING_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Debug, Default, Deserialize, Serialize)]
struct TelemetryState {
    #[serde(default)]
    install_id: Option<String>,
    #[serde(default)]
    last_ping_unix: Option<u64>,
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

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// "Jan Agent", not "Jan": lets the analytics backend tell this ping apart
// from a desktop client, which sends "Jan/{version} (...)" (see
// `custom_updater::build_user_agent`) -- both share the same version number,
// so the client name is the only distinguishing signal in the request.
fn build_user_agent(version: &str) -> String {
    format!(
        "Jan-Agent/{} ({}; {})",
        version,
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

/// Send the anonymous usage ping if 24h have elapsed since the last one (or
/// none was ever sent). Best-effort by design: a missing home directory, an
/// unreachable endpoint, or an unwritable state file all silently no-op, the
/// same as `updater::available_update`.
pub async fn ping_if_due() {
    if std::env::var_os("JAN_CLI_NO_UPDATE_CHECK").is_some() {
        return;
    }
    let Some(path) = state_path() else {
        return;
    };
    let mut state = load_state(&path);
    let now = unix_now();
    if state
        .last_ping_unix
        .is_some_and(|last| now.saturating_sub(last) < PING_INTERVAL_SECS)
    {
        return;
    }

    let install_id = state
        .install_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    state.install_id = Some(install_id.clone());

    let version = env!("CARGO_PKG_VERSION");
    let headers = SignedRequestHeaders::new(SECRET_KEY, &install_id, version);
    if let Ok(client) = reqwest::Client::builder().timeout(PING_TIMEOUT).build() {
        let mut request = client.get(PING_ENDPOINT);
        for (key, value) in headers.to_header_pairs() {
            request = request.header(key, value);
        }
        request = request
            .header("Accept", "application/json")
            .header("User-Agent", build_user_agent(version));
        let _ = tokio::time::timeout(PING_TIMEOUT, request.send()).await;
    }

    // Recorded regardless of the request's outcome: a down endpoint must not
    // turn into a retry storm on every subsequent invocation.
    state.last_ping_unix = Some(now);
    save_state(&path, &state);
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
        assert!(state.last_ping_unix.is_none());
    }

    #[test]
    fn state_roundtrips_through_save_and_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cli_telemetry.json");
        let state = TelemetryState {
            install_id: Some("abc-123".to_string()),
            last_ping_unix: Some(42),
        };
        save_state(&path, &state);
        let loaded = load_state(&path);
        assert_eq!(loaded.install_id.as_deref(), Some("abc-123"));
        assert_eq!(loaded.last_ping_unix, Some(42));
    }

    #[test]
    fn opt_out_env_var_skips_everything() {
        // Guard against parallel test races on the process-wide env var.
        static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        std::env::set_var("JAN_CLI_NO_UPDATE_CHECK", "1");
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(ping_if_due());
        std::env::remove_var("JAN_CLI_NO_UPDATE_CHECK");
    }
}
