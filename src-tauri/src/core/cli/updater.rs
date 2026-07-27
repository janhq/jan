//! Startup update check for the headless `jan` CLI.
//!
//! Only active when the binary was built by the nightly CI templates, which
//! embed `JAN_CLI_UPDATE_CHANNEL` (e.g. `agent-nightly`) and
//! `JAN_CLI_BUILD_VERSION` (the actual nightly version, since `Cargo.toml`'s
//! `version` stays pinned). A local `cargo build --features cli` has neither,
//! so the check is a no-op there.

use std::time::Duration;

use serde::Deserialize;

const CHECK_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    platforms: serde_json::Value,
}

fn update_channel() -> Option<&'static str> {
    option_env!("JAN_CLI_UPDATE_CHANNEL")
}

fn build_version() -> &'static str {
    option_env!("JAN_CLI_BUILD_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

/// Platform key used in `manifest.json`, matching the nightly workflow's
/// `platforms` object.
fn platform_key() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("macos", _) => Some("darwin-universal"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

async fn fetch_manifest(channel: &str) -> Result<UpdateManifest, String> {
    let url = format!("https://delta.jan.ai/{channel}/manifest.json");
    let client = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<UpdateManifest>()
        .await
        .map_err(|e| e.to_string())
}

/// Check for a newer nightly build and print a one-line notice to stderr.
/// Best-effort: any network error, timeout, or missing embed is silently
/// ignored so it never blocks or breaks CLI startup.
pub async fn print_update_notice_if_available() {
    if std::env::var_os("JAN_CLI_NO_UPDATE_CHECK").is_some() {
        return;
    }
    let Some(channel) = update_channel() else {
        return;
    };
    let current = build_version();
    let Ok(Ok(manifest)) =
        tokio::time::timeout(CHECK_TIMEOUT, fetch_manifest(channel)).await
    else {
        return;
    };
    if manifest.version == current {
        return;
    }
    let download_url = platform_key()
        .and_then(|key| manifest.platforms.get(key))
        .and_then(|p| p.get("url"))
        .and_then(|u| u.as_str());
    match download_url {
        Some(url) => eprintln!(
            "A new {channel} build is available: {current} -> {} ({url})",
            manifest.version
        ),
        None => eprintln!(
            "A new {channel} build is available: {current} -> {}",
            manifest.version
        ),
    }
}
