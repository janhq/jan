//! ATO-113: Sentry crash/error telemetry for the desktop app.
//!
//! Desktop-only (never compiled or linked on mobile). Zero-PII by construction:
//! every outgoing event and breadcrumb passes through [`scrub`] in `before_send`
//! / `before_breadcrumb`, and the machine name + IP are stripped. Sending is
//! gated behind the same `productAnalytic` consent as PostHog via a process
//! global `AtomicBool` (default ON) that the frontend keeps in sync through the
//! `set_telemetry_consent` command.

pub mod commands;
pub mod scrub;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use sentry::protocol::{Breadcrumb, Event, Value};
use sentry::{ClientInitGuard, ClientOptions};

pub use scrub::scrub;

/// Telemetry consent. Defaults ON to match the `productAnalytic` default; the
/// frontend reconciles the real persisted value on startup and on every toggle.
static TELEMETRY_ENABLED: AtomicBool = AtomicBool::new(true);

/// Absolute path to `app.log`, set once during Tauri `setup()` so `before_send`
/// can attach a scrubbed tail to crash/error events.
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Cap on the `app.log` tail attached to each event. Kept well under Sentry's
/// per-event payload limit while still giving useful crash context.
const LOG_TAIL_BYTES: usize = 50 * 1024;

pub fn set_consent(enabled: bool) {
    TELEMETRY_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn consent_enabled() -> bool {
    TELEMETRY_ENABLED.load(Ordering::Relaxed)
}

pub fn set_log_path(path: PathBuf) {
    let _ = LOG_PATH.set(path);
}

/// Initialise the Sentry client. Returns `None` (no-op) when no DSN was baked
/// in at build time (e.g. local dev), so the panic hook / log bridge stay inert
/// instead of erroring. The returned guard must be held for the process
/// lifetime (it flushes pending events on drop).
pub fn init() -> Option<ClientInitGuard> {
    let dsn = option_env!("SENTRY_DSN_DESKTOP").unwrap_or("");
    if dsn.is_empty() {
        return None;
    }

    let release = option_env!("SENTRY_RELEASE")
        .filter(|s| !s.is_empty())
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .to_string();
    let environment = option_env!("SENTRY_ENVIRONMENT")
        .filter(|s| !s.is_empty())
        .unwrap_or("production")
        .to_string();

    let options = ClientOptions {
        release: Some(release.into()),
        environment: Some(environment.into()),
        // Zero-PII: never let the SDK attach IPs, usernames, cookies, etc.
        send_default_pii: false,
        max_breadcrumbs: 50,
        before_send: Some(Arc::new(|event| {
            if !consent_enabled() {
                return None;
            }
            Some(scrub_event(event))
        })),
        before_breadcrumb: Some(Arc::new(|crumb| {
            if !consent_enabled() {
                return None;
            }
            Some(scrub_breadcrumb(crumb))
        })),
        ..Default::default()
    };

    Some(sentry::init((dsn, options)))
}

/// Wrap the `tauri-plugin-log` logger so `log::error!` reaches Sentry (as
/// events) and `log::info!`/`warn!` become breadcrumbs, while stdout / webview
/// / file targets keep working. Safe even when Sentry is disabled (no client =
/// no-op forwarding).
pub fn wrap_logger(dest: Box<dyn log::Log>) -> Box<dyn log::Log> {
    Box::new(sentry::integrations::log::SentryLogger::with_dest(dest))
}

/// Strip machine name + IP, scrub every free-text field, and attach a scrubbed
/// `app.log` tail.
fn scrub_event(mut event: Event<'static>) -> Event<'static> {
    // Machine/host name and any IP are forbidden by the zero-PII doctrine.
    event.server_name = None;
    if let Some(user) = event.user.as_mut() {
        user.ip_address = None;
        user.username = None;
        user.email = None;
    }

    if let Some(msg) = event.message.take() {
        event.message = Some(scrub(&msg));
    }
    if let Some(logentry) = event.logentry.as_mut() {
        logentry.message = scrub(&logentry.message);
    }

    for exception in event.exception.values.iter_mut() {
        if let Some(value) = exception.value.as_mut() {
            *value = scrub(value);
        }
        if let Some(stacktrace) = exception.stacktrace.as_mut() {
            for frame in stacktrace.frames.iter_mut() {
                if let Some(filename) = frame.filename.as_mut() {
                    *filename = scrub(filename);
                }
                if let Some(abs_path) = frame.abs_path.as_mut() {
                    *abs_path = scrub(abs_path);
                }
                // Local variables can capture prompts/paths/tokens verbatim.
                frame.vars.clear();
            }
        }
    }

    scrub_map(&mut event.extra);

    if let Some(tail) = read_log_tail() {
        event
            .extra
            .insert("app_log_tail".to_string(), Value::String(tail));
    }

    event
}

fn scrub_breadcrumb(mut crumb: Breadcrumb) -> Breadcrumb {
    if let Some(message) = crumb.message.as_mut() {
        *message = scrub(message);
    }
    scrub_map(&mut crumb.data);
    crumb
}

fn scrub_value(value: &mut Value) {
    match value {
        Value::String(s) => *s = scrub(s),
        Value::Array(arr) => arr.iter_mut().for_each(scrub_value),
        Value::Object(obj) => obj.values_mut().for_each(scrub_value),
        _ => {}
    }
}

fn scrub_map(map: &mut sentry::protocol::Map<String, Value>) {
    for value in map.values_mut() {
        scrub_value(value);
    }
}

fn read_log_tail() -> Option<String> {
    let path = LOG_PATH.get()?;
    let data = std::fs::read(path).ok()?;
    let start = data.len().saturating_sub(LOG_TAIL_BYTES);
    Some(scrub(&String::from_utf8_lossy(&data[start..])))
}
