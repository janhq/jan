//! The supervised llama.cpp worker.
//!
//! Statically linked, but in its own process on purpose. `GGML_ASSERT` calls
//! `abort()` unconditionally (`ggml/src/ggml.c`), and there are thousands of
//! assert sites plus every CUDA/Vulkan error path; `catch_unwind` cannot
//! contain any of them. Jan survives those today only because inference happens
//! in another process, and this preserves that while removing the *downloaded*
//! `llama-server` binary and the router's per-model subprocesses.
//!
//! Usage:
//!   jan-llama-worker --preset <router.preset.ini> [--port N] [--models-max N]
//!
//! The bearer token comes from `JAN_LLAMA_API_KEY`, never argv: argv is
//! readable by any other process on the machine (`ps`, `/proc/<pid>/cmdline`,
//! Task Manager) and the supervisor logs it.
//!
//! Prints one line of JSON on stdout once it is listening, so the supervisor
//! learns the port without racing on a log file:
//!   {"port":39271,"pid":1234,"models":["a","b"]}

use std::sync::Arc;

use tauri_plugin_llamacpp::engine::http::EngineServer;
use tauri_plugin_llamacpp::engine::preset;
use tauri_plugin_llamacpp::engine::registry::Registry;
use tauri_plugin_llamacpp::engine::slots::StateStore;
use tauri_plugin_llamacpp::engine::{assert_pinned_version, PINNED_TAG};
use tokio::sync::Mutex;

struct Args {
    preset: Option<String>,
    port: u16,
    models_max: usize,
    /// Ceiling on the saved-KV directory, in MiB. 0 turns cross-session KV
    /// persistence off entirely: the directory is what the feature is, so
    /// there is nothing to keep without a budget for it.
    slot_cache_mib: u64,
    /// Print the offloadable devices as JSON and exit. The desktop process
    /// links the plugin *without* the engine feature, so it has no ggml to ask
    /// -- it shells out here, exactly as it used to shell out to
    /// `llama-server --list-devices`.
    list_devices: bool,
}

/// Read from the environment rather than argv so the token never appears in a
/// process listing. Empty means "no auth", which is only sensible when the
/// caller owns the loopback port outright (tests).
const API_KEY_ENV: &str = "JAN_LLAMA_API_KEY";

fn parse_args() -> Result<Args, String> {
    let mut out = Args {
        preset: None,
        port: 0,
        models_max: 1,
        slot_cache_mib: 0,
        list_devices: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = || {
            it.next()
                .ok_or_else(|| format!("{flag} needs a value"))
        };
        match flag.as_str() {
            "--preset" => out.preset = Some(value()?),
            "--port" => {
                out.port = value()?.parse().map_err(|e| format!("bad --port: {e}"))?
            }
            "--models-max" => {
                out.models_max = value()?
                    .parse()
                    .map_err(|e| format!("bad --models-max: {e}"))?
            }
            "--slot-cache-mib" => {
                out.slot_cache_mib = value()?
                    .parse()
                    .map_err(|e| format!("bad --slot-cache-mib: {e}"))?
            }
            "--list-devices" => out.list_devices = true,
            "--version" => {
                println!("jan-llama-worker (llama.cpp {PINNED_TAG})");
                std::process::exit(0);
            }
            other => return Err(format!("unknown flag: {other}")),
        }
    }
    Ok(out)
}

#[tokio::main]
async fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("jan-llama-worker: {e}");
            std::process::exit(2);
        }
    };

    // A mismatched llama.cpp is memory corruption, not a link error:
    // common_params and llama_context_params cross the boundary by value and
    // their layout has changed repeatedly upstream.
    if let Err(e) = assert_pinned_version() {
        eprintln!("jan-llama-worker: {e}");
        std::process::exit(3);
    }

    // Must precede any ggml call, including device enumeration.
    tauri_plugin_llamacpp::engine::load_backend_modules();

    if args.list_devices {
        match tauri_plugin_llamacpp::engine::Engine::devices_json() {
            Ok(json) => println!("{json}"),
            Err(e) => {
                eprintln!("jan-llama-worker: could not list devices: {e}");
                std::process::exit(6);
            }
        }
        return;
    }

    let mut registry = Registry::new(args.models_max);
    let mut models = Vec::new();
    let mut slot_store = None;

    if let Some(path) = &args.preset {
        let ini = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("jan-llama-worker: could not read {path}: {e}");
                std::process::exit(4);
            }
        };
        for (section, spec) in preset::specs(path, &ini) {
            registry.register(section.clone(), spec);
            models.push(section);
        }
        models.sort();

        // The directory has to exist before any model loads: llama.cpp's
        // --slot-save-path handler throws when it does not, and that unwinds
        // out of engine startup, so a missing cache directory would take local
        // inference down rather than disabling one feature.
        if let Some(dir) = preset::shared_value(&ini, "slot-save-path") {
            let store = StateStore::new(&dir, args.slot_cache_mib);
            if let Err(e) = store.ensure_dir() {
                eprintln!("jan-llama-worker: could not create {dir}: {e}");
                std::process::exit(7);
            }
            // Pruned here, not only on reload: a budget lowered (or zeroed)
            // between sessions must reclaim the disk it was lowered for, and
            // nothing else walks this directory at startup.
            let dropped = store.prune().len();
            if dropped > 0 {
                eprintln!("jan-llama-worker: pruned {dropped} saved thread cache(s)");
            }
            // Kept even at a zero budget: erasing a deleted thread's state and
            // clearing the directory both need the store, and neither writes.
            slot_store = Some(store);
        }
    }

    let registry = Arc::new(Mutex::new(registry));
    // Taken (not read) so it does not linger in this process's environment,
    // which is also readable via /proc on Linux.
    let api_key = std::env::var(API_KEY_ENV).unwrap_or_default();
    std::env::remove_var(API_KEY_ENV);

    let registry_for_teardown = Arc::clone(&registry);
    let (server, listener) =
        match EngineServer::bind(registry, args.port, api_key).await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("jan-llama-worker: could not bind: {e}");
                std::process::exit(5);
            }
        };
    let server = match slot_store {
        Some(store) => {
            if store.saves_enabled() {
                eprintln!(
                    "jan-llama-worker: keeping up to {} MiB of thread KV cache in {}",
                    args.slot_cache_mib,
                    store.dir().display()
                );
            } else {
                eprintln!(
                    "jan-llama-worker: thread KV cache is off; keeping {} clear",
                    store.dir().display()
                );
            }
            server.with_slot_state(store)
        }
        None => server,
    };

    // The supervisor reads this instead of scraping stderr, which is what the
    // router path had to do.
    println!(
        "{}",
        serde_json::json!({
            "port": server.port,
            "pid": std::process::id(),
            "models": models,
        })
    );
    // stdout is a pipe to the supervisor, so it is block-buffered.
    use std::io::Write;
    let _ = std::io::stdout().flush();

    let server = Arc::new(server);
    Arc::clone(&server)
        .serve_until(listener, shutdown_requested(), DRAIN_TIMEOUT)
        .await;

    // After draining, before releasing the models: the save reads each slot
    // through its still-live engine. Closing Jan is the common way a thread
    // stops being current, so without this the feature would only ever help
    // across a thread switch, not across a session.
    server.save_resident_slots().await;

    // Releasing the models here is the whole point of exiting in-band: each
    // Engine's Drop runs jan_llama_engine_stop, terminating its server_queue
    // loop and freeing the weights. A force-killed process skips all of that.
    let released = registry_for_teardown.lock().await.shutdown();
    if !released.is_empty() {
        eprintln!("jan-llama-worker: released {}", released.join(", "));
    }
}

/// How long in-flight requests get to finish once shutdown is requested.
const DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Resolves when the supervisor asks us to stop.
///
/// The signal is **stdin reaching EOF**, which happens when the supervisor drops
/// its end of the pipe. Chosen over a signal because Windows has no deliverable
/// SIGTERM equivalent (`GenerateConsoleCtrlEvent(CTRL_C_EVENT)` requires process
/// group 0, which would take Jan down with it), and over an HTTP route because
/// process lifetime is not the transport's business -- and because only our
/// parent holds the write end, so it needs no authentication.
///
/// SIGTERM is still honoured on Unix so `kill` on a stuck worker behaves.
async fn shutdown_requested() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("jan-llama-worker: could not watch SIGTERM: {e}");
                stdin_eof().await;
                return;
            }
        };
        tokio::select! {
            _ = stdin_eof() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    stdin_eof().await;
}

async fn stdin_eof() {
    use tokio::io::AsyncReadExt;
    let mut stdin = tokio::io::stdin();
    let mut buf = [0u8; 64];
    loop {
        match stdin.read(&mut buf).await {
            // EOF: the supervisor closed the pipe.
            Ok(0) => return,
            // Nothing is expected to be written; ignore it rather than exiting,
            // so a stray byte cannot shut the engine down.
            Ok(_) => continue,
            Err(_) => return,
        }
    }
}
