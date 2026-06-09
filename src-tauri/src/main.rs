// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let _ = fix_path_env::fix();

    // ATO-113: bring up Sentry as early as possible so the panic hook is armed
    // before any work happens. The guard must live for the whole process (it
    // flushes pending events on drop), so it is held until `main` returns.
    // No-op when no DSN was baked in (e.g. local dev builds).
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _sentry_guard = app_lib::core::telemetry::init();

    // Ensure localhost bypasses any configured HTTP/SOCKS proxy.
    // Without this, the Tauri HTTP plugin (reqwest) picks up the macOS
    // system proxy and routes local llama-server requests through it,
    // which breaks communication with the local inference backend.
    let local_hosts = "localhost,127.0.0.1,::1,0.0.0.0";
    for key in &["NO_PROXY", "no_proxy"] {
        match std::env::var(key) {
            Ok(existing) if !existing.is_empty() => {
                std::env::set_var(key, format!("{},{}", existing, local_hosts));
            }
            _ => {
                std::env::set_var(key, local_hosts);
            }
        }
    }

    // Normal Tauri app startup
    app_lib::run();
}
