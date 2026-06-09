//! Tauri commands the frontend uses to keep the Rust Sentry client in sync with
//! the `productAnalytic` consent toggle and to push the same zero-PII hardware
//! tags it sends to its own Sentry project.

use std::collections::HashMap;

/// Mirror the `productAnalytic` consent into the Rust telemetry gate. Called by
/// the frontend on startup (with the persisted value) and on every toggle.
#[tauri::command]
pub fn set_telemetry_consent(enabled: bool) {
    super::set_consent(enabled);
}

/// Set zero-PII tags (hardware/backend/model context) on the global Sentry
/// scope so Rust crash events carry the same context as the frontend. The
/// frontend only ever passes allow-listed, non-PII values (no GPU UUID/serial,
/// no hostname, no username).
#[tauri::command]
pub fn set_telemetry_context(tags: HashMap<String, String>) {
    sentry::configure_scope(|scope| {
        for (key, value) in tags {
            scope.set_tag(&key, value);
        }
    });
}
