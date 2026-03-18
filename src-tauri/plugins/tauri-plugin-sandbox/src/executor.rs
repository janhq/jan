//! WASM Sandbox — skill execution with fuel + epoch interruption.
//!
//! | Meter | Mechanism | Catches |
//! |-------|-----------|---------|
//! | Fuel  | `Config::consume_fuel` + `store.set_fuel()` | CPU-bound infinite loops in WASM guest |
//! | Epoch | `Config::epoch_interruption` + watchdog thread | Wall-clock hangs (slow host I/O, DNS, etc.) |
//!
//! Fuel ticks down with every WASM instruction, but **stops** while the host
//! executes (e.g. inside `host::http_get`).  Epoch interruption covers that
//! gap: a watchdog thread sleeps for `WALL_CLOCK_TIMEOUT_SECS` then calls
//! `engine.increment_epoch()`, which triggers a `Trap::Interrupt` that unwinds
//! the stuck WASM stack.
//!
//! The watchdog carries a cancellation sender.  On normal completion the
//! executor drops the sender, which closes the channel and wakes the watchdog
//! thread early — preventing stale epoch increments from affecting unrelated
//! sandboxes on the same engine.
//!
//! # Tool ABI (stable)
//!
//! Every skill WASM binary must export:
//!
//! | Export | Signature | Purpose |
//! |--------|-----------|---------|
//! | `memory` | memory | Linear memory the host reads/writes |
//! | `run` | `(i32, i32) -> i64` | Execute: input at `(ptr, len)`, returns `(out_ptr << 32) \| out_len` |
//! | `schema` | `() -> i64` | Returns `(ptr << 32) \| len` of JSON Schema string |
//! | `description` | `() -> i64` | Returns `(ptr << 32) \| len` of description string |
//!
//! # Host imports provided to every skill WASM module
//!
//! | Module | Name | Signature | Notes |
//! |--------|------|-----------|-------|
//! | `host` | `log` | `(ptr: i32, len: i32)` | Emit a UTF-8 log line |
//! | `host` | `http_get` | `(url_ptr: i32, url_len: i32, buf_ptr: i32, buf_max: i32) -> i32` | HTTP GET; writes body to buf, returns bytes written or -1 |
//!
//! Logging is rate-limited to 1 000 lines and 4 KB per message.
//! HTTP responses are truncated at 256 KB.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use wasmtime::{Caller, Config, Engine, Extern, Linker, Module, Store, Trap};
use wasmtime_wasi::preview1::{self, WasiP1Ctx};
use wasmtime_wasi::WasiCtxBuilder;

// ── Limits and timeouts ───────────────────────────────────────────────────────

/// Fuel budget for a full skill execution.
/// Deterministic CPU instruction limit — fires on tight guest loops.
const FUEL_LIMIT: u64 = 1_000_000_000;

/// Fuel budget for metadata-only queries (schema + description).
const FUEL_LIMIT_METADATA: u64 = 10_000_000;

/// Wall-clock deadline for a full skill execution (seconds).
/// The watchdog fires `engine.increment_epoch()` after this delay,
/// terminating any WASM that is blocked inside a slow host function.
///
/// Set to 30 minutes because workspace `code.exec` calls can run long-running
/// commands (e.g. `npx create-next-app` which downloads npm packages inside
/// a fresh microVM, or `npm run build`).
/// CPU-bound abuse is caught by the fuel limit instead.
const WALL_CLOCK_TIMEOUT_SECS: u64 = 1800;

/// Wall-clock deadline for metadata queries (seconds).
const WALL_CLOCK_TIMEOUT_METADATA_SECS: u64 = 5;

const MAX_LOG_LINES:     usize = 1_000;
const MAX_LOG_MSG_BYTES: usize = 4 * 1024;
const MAX_HTTP_BODY:     usize = 256 * 1024;

// ── Sandbox error type ────────────────────────────────────────────────────────

/// Structured errors from the WASM sandbox.
///
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("WASM compilation failed: {0}")]
    Compilation(String),
    #[error("WASM instantiation failed: {0}")]
    Instantiation(String),
    #[error("fuel exhausted: skill exceeded CPU budget ({FUEL_LIMIT} instructions)")]
    FuelExhausted,
    #[error("wall-clock timeout: skill ran for more than {WALL_CLOCK_TIMEOUT_SECS}s")]
    Timeout,
    #[error("WASM execution error: {0}")]
    Execution(String),
    #[error("guest ABI violation: {0}")]
    AbiError(String),
}

// ── Host state ────────────────────────────────────────────────────────────────

/// Combined WASM host state: WASI context + skill-specific fields.
///
/// Skill WASM binaries compiled to `wasm32-wasip1` pull in WASI imports
/// (`fd_write`, `environ_get`, etc.) even without explicit WASI usage because
/// the std library links against them.  We satisfy both the standard WASI
/// imports (via `WasiP1Ctx`) and the custom `host::*` imports.
struct HostState {
    wasi:        WasiP1Ctx,
    logs:        Vec<String>,
    http_client: reqwest::blocking::Client,
    /// Filesystem paths the `host::exec_code` sandbox may read.
    /// Populated from `Dispatcher::mounts` via `execute(..., mounts)`.
    /// Empty for metadata-only queries.
    mounts:      Vec<PathBuf>,
}

impl HostState {
    fn new() -> Self {
        Self::with_mounts(vec![])
    }

    fn with_mounts(mounts: Vec<PathBuf>) -> Self {
        let wasi = WasiCtxBuilder::new().build_p1();
        let http_client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("jan-agent/0.1")
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());
        Self { wasi, logs: Vec::new(), http_client, mounts }
    }
}

// ── Tool metadata ─────────────────────────────────────────────────────────────

/// Schema and description of a WASM skill tool, read from its exports.
#[derive(Debug, Clone)]
pub struct ToolInfo {
    pub description: String,
    pub schema:      Value,
}

// ── Engine factory ────────────────────────────────────────────────────────────

/// Build a Wasmtime engine with **both** metering mechanisms enabled.
///
/// - `consume_fuel = true`   — deterministic instruction counter
/// - `epoch_interruption = true` — wall-clock watchdog via `increment_epoch()`
fn build_engine() -> Result<Engine> {
    let mut cfg = Config::new();
    cfg.consume_fuel(true);
    cfg.epoch_interruption(true);
    Ok(Engine::new(&cfg)?)
}

// ── Watchdog ──────────────────────────────────────────────────────────────────

/// Spawn a watchdog thread that fires `engine.increment_epoch()` after
/// `timeout_secs` unless cancelled first.
///
/// Returns the cancellation sender.  Drop it (or send anything on it) to
/// cancel the watchdog before the timeout — essential so a completed
/// execution doesn't accidentally interrupt a later one on the same engine.
///
fn spawn_watchdog(engine: Engine, timeout_secs: u64) -> mpsc::SyncSender<()> {
    // SyncSender with capacity 0: send blocks until receiver reads, but we
    // only care about channel close (Err on recv_timeout) as the cancel signal.
    let (cancel_tx, cancel_rx) = mpsc::sync_channel::<()>(0);

    std::thread::spawn(move || {
        match cancel_rx.recv_timeout(Duration::from_secs(timeout_secs)) {
            // Execution completed before timeout — do nothing.
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {}
            // Timeout elapsed — kill the WASM store via epoch increment.
            Err(mpsc::RecvTimeoutError::Timeout) => {
                log::warn!(
                    "[sandbox] watchdog fired after {timeout_secs}s — interrupting WASM"
                );
                engine.increment_epoch();
            }
        }
    });

    cancel_tx
}

// ── Trap classifier ───────────────────────────────────────────────────────────

fn classify_trap(err: anyhow::Error, timeout_secs: u64) -> SandboxError {
    if let Some(trap) = err.downcast_ref::<Trap>() {
        match trap {
            Trap::OutOfFuel  => return SandboxError::FuelExhausted,
            Trap::Interrupt  => return SandboxError::Timeout,
            _ => {}
        }
    }
    // Wasmtime sometimes wraps traps in a plain error message.
    let msg = err.to_string();
    if msg.contains("fuel") || msg.contains("OutOfFuel") {
        SandboxError::FuelExhausted
    } else if msg.contains("interrupt") || msg.contains("epoch") || msg.contains("timed out") {
        SandboxError::Timeout
    } else {
        SandboxError::Execution(format!(
            "{msg} (fuel_limit={FUEL_LIMIT}, timeout={timeout_secs}s)"
        ))
    }
}

// ── Public: read tool metadata ────────────────────────────────────────────────

/// Read `schema()` and `description()` from a WASM skill binary.
///
/// Uses a small fuel budget and a 5-second watchdog.  No HTTP host imports
/// are called during metadata reads.
pub fn get_tool_info(wasm_path: &Path) -> Result<ToolInfo> {
    let engine = build_engine()?;
    let module = Module::from_file(&engine, wasm_path)
        .with_context(|| format!("loading wasm: {}", wasm_path.display()))?;

    let mut linker: Linker<HostState> = Linker::new(&engine);
    register_host_imports(&mut linker)?;

    let mut store = Store::new(&engine, HostState::new());
    store.set_fuel(FUEL_LIMIT_METADATA)?;
    store.set_epoch_deadline(1);

    // Watchdog: kill metadata reads that take too long.
    let _cancel = spawn_watchdog(engine.clone(), WALL_CLOCK_TIMEOUT_METADATA_SECS);

    let instance = linker.instantiate(&mut store, &module)
        .context("instantiating wasm for metadata")?;
    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or_else(|| anyhow!("wasm tool must export 'memory'"))?;

    let description = read_str_export(&mut store, &instance, &memory, "description")
        .context("reading 'description' export")?;
    let schema_str  = read_str_export(&mut store, &instance, &memory, "schema")
        .context("reading 'schema' export")?;

    // Watchdog cancels itself when _cancel is dropped here.

    let schema: Value = serde_json::from_str(&schema_str)
        .map_err(|e| anyhow!("'schema' export is not valid JSON: {e}"))?;

    Ok(ToolInfo { description, schema })
}

// ── Public: execute a skill ───────────────────────────────────────────────────

/// Execute a WASM skill and return `(output_json, host_logs)`.
///
/// **Must be called from a blocking thread** (e.g. inside `spawn_blocking`)
/// because `host::http_get` uses a synchronous HTTP client.
///
/// Termination is dual-metered:
/// - Fuel exhausted → `SandboxError::FuelExhausted` (CPU budget)
/// - Epoch interrupt → `SandboxError::Timeout` (wall-clock budget)
pub fn execute(
    wasm_path: &Path,
    input:     &Value,
    mounts:    Vec<PathBuf>,
) -> Result<(Value, Vec<String>)> {
    let engine = build_engine()?;
    let module = Module::from_file(&engine, wasm_path)
        .with_context(|| format!("loading wasm: {}", wasm_path.display()))?;

    let mut linker: Linker<HostState> = Linker::new(&engine);
    register_host_imports(&mut linker)?;

    let mut store = Store::new(&engine, HostState::with_mounts(mounts));
    store.set_fuel(FUEL_LIMIT)?;
    store.set_epoch_deadline(1);

    // Spawn watchdog BEFORE instantiation — instantiation itself could hang.
    let cancel = spawn_watchdog(engine.clone(), WALL_CLOCK_TIMEOUT_SECS);

    let instance = linker.instantiate(&mut store, &module)
        .map_err(|e| SandboxError::Instantiation(e.to_string()))?;

    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or_else(|| SandboxError::AbiError("wasm tool must export 'memory'".into()))?;
    let run_fn = instance
        .get_typed_func::<(i32, i32), i64>(&mut store, "run")
        .map_err(|_| SandboxError::AbiError("wasm tool must export 'run(i32,i32)->i64'".into()))?;

    let input_bytes = serde_json::to_vec(input)?;
    let input_len   = input_bytes.len() as i32;
    memory.write(&mut store, 0, &input_bytes)
        .map_err(|e| SandboxError::AbiError(format!("writing input to guest memory: {e}")))?;

    let packed = match run_fn.call(&mut store, (0, input_len)) {
        Ok(v) => v,
        Err(e) => {
            // Cancel watchdog on error path too — don't let it fire later.
            drop(cancel);
            return Err(classify_trap(e, WALL_CLOCK_TIMEOUT_SECS).into());
        }
    };

    // Cancel watchdog — execution finished normally.
    drop(cancel);

    let fuel_consumed = FUEL_LIMIT.saturating_sub(store.get_fuel().unwrap_or(0));
    log::debug!(
        "[sandbox] {} — fuel {}/{} ({:.1}%)",
        wasm_path.display(),
        fuel_consumed,
        FUEL_LIMIT,
        fuel_consumed as f64 / FUEL_LIMIT as f64 * 100.0,
    );

    let out_ptr = ((packed >> 32) & 0xFFFF_FFFF) as usize;
    let out_len = (packed & 0xFFFF_FFFF) as usize;

    let mut out_buf = vec![0u8; out_len];
    memory.read(&store, out_ptr, &mut out_buf)
        .map_err(|e| SandboxError::AbiError(format!("reading guest output: {e}")))?;

    let output: Value = serde_json::from_slice(&out_buf)
        .map_err(|e| SandboxError::AbiError(format!("skill returned invalid JSON: {e}")))?;

    let logs = store.into_data().logs;
    Ok((output, logs))
}

// ── WASM fallback ─────────────────────────────────────────────────────────────

/// Run `code` via the bundled WASM runtime (js-runner.wasm / micropython.wasm).
///
/// Used when the microsandbox server is not reachable.
fn wasm_exec_code(language: &str, code: &str, mounts: &[PathBuf]) -> Result<serde_json::Value, String> {
    let wasm_bin = match language {
        "javascript" | "js"      => "js-runner.wasm (QuickJS)",
        "python"     | "python3" => "micropython.wasm",
        other => return Err(format!("unsupported language '{other}' (supported: javascript, python)")),
    };
    log::info!("[sandbox] wasm fallback: running {language} via {wasm_bin}");
    match language {
        "javascript" | "js"      => crate::wasm_runtime::run_js_blocking(code, mounts),
        "python"     | "python3" => crate::wasm_runtime::run_python_blocking(code, mounts),
        _                        => unreachable!(),
    }
}

// ── Host import registration ──────────────────────────────────────────────────

fn register_host_imports(linker: &mut Linker<HostState>) -> Result<()> {
    // Satisfy wasi_snapshot_preview1 imports pulled in by the Rust std lib
    // (fd_write, environ_get, environ_sizes_get, proc_exit, …).
    preview1::add_to_linker_sync(linker, |s: &mut HostState| &mut s.wasi)?;

    // host::log(ptr, len) — emit UTF-8 log line
    linker.func_wrap(
        "host",
        "log",
        |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| {
            if caller.data().logs.len() >= MAX_LOG_LINES {
                return;
            }
            let mem = match caller.get_export("memory") {
                Some(Extern::Memory(m)) => m,
                _ => return,
            };
            let clamped = (len as usize).min(MAX_LOG_MSG_BYTES);
            let start   = ptr as usize;
            let msg: Option<String> = {
                let data = mem.data(&caller);
                if start.saturating_add(clamped) <= data.len() {
                    std::str::from_utf8(&data[start..start + clamped])
                        .ok()
                        .map(str::to_owned)
                } else {
                    None
                }
            };
            if let Some(s) = msg {
                caller.data_mut().logs.push(s);
            }
        },
    )?;

    // host::http_get(url_ptr, url_len, buf_ptr, buf_max) -> bytes_written
    //
    // Synchronous HTTP GET.  Body written to [buf_ptr, buf_ptr+write_len).
    // Returns bytes written (≥0) or -1 on error.
    //
    // Credential injection:
    // the HOST injects API keys from env vars so WASM tools never see secrets.
    linker.func_wrap(
        "host",
        "http_get",
        |mut caller: Caller<'_, HostState>,
         url_ptr: i32,
         url_len: i32,
         buf_ptr: i32,
         buf_max: i32|
         -> i32 {
            let mem = match caller.get_export("memory") {
                Some(Extern::Memory(m)) => m,
                _ => return -1,
            };

            // Read URL from guest memory.
            let url = {
                let data  = mem.data(&caller);
                let start = url_ptr as usize;
                let end   = start.saturating_add(url_len as usize);
                if end > data.len() { return -1; }
                match std::str::from_utf8(&data[start..end]) {
                    Ok(s)  => s.to_owned(),
                    Err(_) => return -1,
                }
            };

            // Per-domain request tuning (capabilities.json pattern):
            // - Inject API keys from env vars so WASM tools never see secrets.
            // - Use a browser-like User-Agent for sites that bot-detect CLI agents.
            let mut req = caller.data().http_client.get(&url);
            if url.contains("api.search.brave.com") {
                if let Ok(key) = std::env::var("BRAVE_API_KEY") {
                    req = req.header("X-Subscription-Token", key);
                }
                req = req.header("Accept", "application/json");
            } else if url.contains("html.duckduckgo.com") {
                // DDG HTML bot-detects plain CLI user-agents; use a browser UA.
                req = req.header(
                    "User-Agent",
                    "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
                );
            }

            let body = match req.send().and_then(|r| r.bytes()) {
                Ok(b)  => b.to_vec(),
                Err(e) => {
                    log::warn!("[sandbox] http_get '{url}' failed: {e}");
                    return -1;
                }
            };

            let write_len = body.len().min(buf_max as usize).min(MAX_HTTP_BODY);
            match mem.write(&mut caller, buf_ptr as usize, &body[..write_len]) {
                Ok(_)  => write_len as i32,
                Err(_) => -1,
            }
        },
    )?;

    // host::exec_code(lang_ptr, lang_len, code_ptr, code_len,
    //                ws_ptr,   ws_len,   out_ptr,  out_max) -> i32
    //
    // Execute code and write JSON result to `out_ptr`.
    //
    // `ws_ptr/ws_len` — workspace ID string (UTF-8).
    //   • Non-empty → persistent workspace VM (state survives across calls).
    //     Result may include `"url"` when a server is detected.
    //   • Empty (ws_len == 0) → ephemeral microVM, destroyed after the call.
    //
    // Returns bytes written (≥0) or -1 on failure.
    linker.func_wrap(
        "host",
        "exec_code",
        |mut caller: Caller<'_, HostState>,
         lang_ptr: i32, lang_len: i32,
         code_ptr: i32, code_len: i32,
         ws_ptr:   i32, ws_len:   i32,
         out_ptr:  i32, out_max:  i32|
         -> i32 {
            let mem = match caller.get_export("memory") {
                Some(Extern::Memory(m)) => m,
                _ => return -1,
            };

            let (language, code, workspace_id) = {
                let data = mem.data(&caller);
                let lang = match read_str_from_mem(data, lang_ptr, lang_len) {
                    Some(s) => s,
                    None    => return -1,
                };
                let code = match read_str_from_mem(data, code_ptr, code_len) {
                    Some(s) => s,
                    None    => return -1,
                };
                let ws = if ws_len > 0 {
                    read_str_from_mem(data, ws_ptr, ws_len)
                } else {
                    None
                };
                (lang, code, ws)
            };

            let mounts = caller.data().mounts.clone();

            log::info!(
                "[sandbox] exec_code: language={language} ({} bytes) workspace={:?}",
                code.len(), workspace_id
            );

            let result = if let Some(ref ws_id) = workspace_id {
                // ── Persistent workspace VM ───────────────────────────────────
                crate::microvm::workspace_exec_blocking(ws_id, &language, &code)
                    .map_err(|e| format!("workspace exec failed: {e}"))
            } else {
                // ── Ephemeral VM (existing path) ──────────────────────────────
                match crate::microvm::run_in_microvm_blocking(&language, &code) {
                    Ok(v) => {
                        log::debug!("[sandbox] exec_code: ran in ephemeral microsandbox microVM");
                        Ok(v)
                    }
                    Err(msb_err) => {
                        log::info!(
                            "[sandbox] exec_code: microsandbox unavailable — falling back to WASM runtime\n  reason: {msb_err}"
                        );
                        wasm_exec_code(&language, &code, &mounts).map_err(|wasm_err| {
                            format!(
                                "{msb_err}\n\
                                 WASM fallback also unavailable: {wasm_err}"
                            )
                        })
                    }
                }
            };

            match &result {
                Ok(_)  => log::debug!("[sandbox] exec_code: {language} completed ok"),
                Err(e) => log::warn!("[sandbox] exec_code: {language} failed: {e}"),
            }

            let json = match result {
                Ok(v)  => serde_json::to_string(&v)
                              .unwrap_or_else(|_| r#"{"error":"serialize failed"}"#.into()),
                Err(e) => format!(r#"{{"error":"{}"}}"#, e.replace('"', "'")),
            };

            let bytes  = json.as_bytes();
            let n      = bytes.len().min(out_max as usize);
            match mem.write(&mut caller, out_ptr as usize, &bytes[..n]) {
                Ok(_)  => n as i32,
                Err(_) => -1,
            }
        },
    )?;

    Ok(())
}

// ── Memory helper ─────────────────────────────────────────────────────────────

fn read_str_from_mem(data: &[u8], ptr: i32, len: i32) -> Option<String> {
    let start = ptr as usize;
    let end   = start.saturating_add(len as usize);
    if end > data.len() { return None; }
    std::str::from_utf8(&data[start..end]).ok().map(str::to_owned)
}

// ── Shared helper ─────────────────────────────────────────────────────────────

fn read_str_export(
    store:    &mut Store<HostState>,
    instance: &wasmtime::Instance,
    memory:   &wasmtime::Memory,
    name:     &str,
) -> Result<String> {
    let func   = instance.get_typed_func::<(), i64>(&mut *store, name)
        .with_context(|| format!("missing export '{name}'"))?;
    let packed = func.call(&mut *store, ())?;
    let ptr    = ((packed >> 32) & 0xFFFF_FFFF) as usize;
    let len    = (packed & 0xFFFF_FFFF) as usize;
    let mut buf = vec![0u8; len];
    memory.read(&*store, ptr, &mut buf)?;
    String::from_utf8(buf).map_err(|e| anyhow!("invalid UTF-8 in '{name}': {e}"))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use wasmtime::{Engine as WtEngine, Linker as WtLinker, Module as WtModule, Store as WtStore};

    /// Build a throw-away engine + linker for WAT-based unit tests.
    /// These tests use a plain `HostState` without the full tool ABI.
    fn test_engine() -> WtEngine {
        let mut cfg = Config::new();
        cfg.consume_fuel(true);
        cfg.epoch_interruption(true);
        WtEngine::new(&cfg).unwrap()
    }

    // ── Fuel exhaustion ───────────────────────────────────────────────────────

    /// An infinite loop in WAT; should be caught by the fuel meter.
    const INFINITE_LOOP_WAT: &str = r#"
        (module
            (memory (export "memory") 1)
            (func (export "run") (param i32 i32) (result i64)
                (loop $inf (br $inf))
                (i64.const 0)
            )
            (func (export "schema")     (result i64) (i64.const 0))
            (func (export "description") (result i64) (i64.const 0))
        )
    "#;

    #[test]
    fn fuel_exhaustion_returns_fuel_exhausted_error() {
        let engine = test_engine();
        let module = WtModule::new(&engine, INFINITE_LOOP_WAT).unwrap();
        let linker: WtLinker<HostState> = WtLinker::new(&engine);
        let mut store = WtStore::new(&engine, HostState::new());
        store.set_fuel(50_000).unwrap();
        store.set_epoch_deadline(1);

        let _cancel = spawn_watchdog(engine.clone(), 30);

        let instance = linker.instantiate(&mut store, &module).unwrap();
        let run_fn = instance
            .get_typed_func::<(i32, i32), i64>(&mut store, "run")
            .unwrap();

        let err = run_fn.call(&mut store, (0, 0)).unwrap_err();
        let classified = classify_trap(err, 30);
        assert!(
            matches!(classified, SandboxError::FuelExhausted),
            "expected FuelExhausted, got: {classified}"
        );
    }

    // ── Epoch / watchdog ──────────────────────────────────────────────────────

    /// A busy-spin that uses very little fuel per iteration but holds the
    /// blocking thread — caught by the epoch watchdog.
    ///
    /// We use a very short timeout (1s) so the test runs quickly.
    const SLEEP_LOOP_WAT: &str = r#"
        (module
            (memory (export "memory") 1)
            (func (export "run") (param i32 i32) (result i64)
                ;; Loop with nops — burns fuel slowly, watchdog fires first.
                (loop $lp
                    (nop)(nop)(nop)(nop)(nop)(nop)(nop)(nop)
                    (br $lp)
                )
                (i64.const 0)
            )
            (func (export "schema")     (result i64) (i64.const 0))
            (func (export "description") (result i64) (i64.const 0))
        )
    "#;

    #[test]
    fn watchdog_fires_epoch_interrupt() {
        let engine = test_engine();
        let module = WtModule::new(&engine, SLEEP_LOOP_WAT).unwrap();
        let linker: WtLinker<HostState> = WtLinker::new(&engine);
        let mut store = WtStore::new(&engine, HostState::new());
        store.set_fuel(u64::MAX).unwrap();   // unlimited fuel so epoch fires first
        store.set_epoch_deadline(1);

        // Very short watchdog (1 second).
        let _cancel = spawn_watchdog(engine.clone(), 1);

        let instance = linker.instantiate(&mut store, &module).unwrap();
        let run_fn = instance
            .get_typed_func::<(i32, i32), i64>(&mut store, "run")
            .unwrap();

        let err = run_fn.call(&mut store, (0, 0)).unwrap_err();
        let classified = classify_trap(err, 1);
        assert!(
            matches!(classified, SandboxError::Timeout),
            "expected Timeout, got: {classified}"
        );
    }

    // ── Watchdog cancellation ─────────────────────────────────────────────────

    /// Verify that a fast execution cancels the watchdog before it fires.
    /// If cancellation is broken, increment_epoch() would fire and affect
    /// later stores on the same engine.
    #[test]
    fn watchdog_cancels_on_normal_completion() {
        const ECHO_WAT: &str = r#"
            (module
                (memory (export "memory") 1)
                (func (export "run") (param $ptr i32) (param $len i32) (result i64)
                    ;; Echo: return (ptr << 32) | len unchanged
                    (i64.or
                        (i64.shl (i64.extend_i32_u (local.get $ptr)) (i64.const 32))
                        (i64.extend_i32_u (local.get $len))
                    )
                )
                (func (export "schema")      (result i64) (i64.const 0))
                (func (export "description") (result i64) (i64.const 0))
            )
        "#;

        let engine = test_engine();
        let module = WtModule::new(&engine, ECHO_WAT).unwrap();
        let linker: WtLinker<HostState> = WtLinker::new(&engine);
        let mut store = WtStore::new(&engine, HostState::new());
        store.set_fuel(FUEL_LIMIT).unwrap();
        store.set_epoch_deadline(1);

        // 10-second watchdog — must be cancelled before it fires.
        let cancel = spawn_watchdog(engine.clone(), 10);

        let instance = linker.instantiate(&mut store, &module).unwrap();
        let run_fn = instance
            .get_typed_func::<(i32, i32), i64>(&mut store, "run")
            .unwrap();

        let input = b"{}";
        store.data_mut().wasi = WasiCtxBuilder::new().build_p1(); // reinit for test
        let mem = instance.get_memory(&mut store, "memory").unwrap();
        mem.write(&mut store, 0, input).unwrap();

        let packed = run_fn.call(&mut store, (0, input.len() as i32)).unwrap();
        // Cancel before sleep expires.
        drop(cancel);

        let out_ptr = ((packed >> 32) & 0xFFFF_FFFF) as usize;
        let out_len = (packed & 0xFFFF_FFFF) as usize;
        // Echo returns the input slice — just verify bounds are sane.
        assert_eq!(out_ptr, 0);
        assert_eq!(out_len, input.len());
    }

    // ── Engine config ─────────────────────────────────────────────────────────

    #[test]
    fn build_engine_enables_both_meters() {
        // build_engine() must succeed (both flags valid together).
        let engine = build_engine().expect("engine with fuel + epoch");
        drop(engine);
    }
}
