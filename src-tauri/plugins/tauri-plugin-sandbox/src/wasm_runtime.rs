//! WASM sandbox for untrusted code execution.
//!
//! ## Memory model
//!
//! The Engine + Module are compiled once and cached for the process lifetime
//! (~50–70 MB, one-time cost).  Only the Store (~KB) is created per execution
//! and dropped immediately after, so memory is flat across repeated calls.
//!
//! Timeout uses Wasmtime fuel — a per-Store instruction budget, no background
//! thread required.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use wasmtime::{Config, Engine, Linker, Module, Store};
use wasmtime_wasi::preview1::{self, WasiP1Ctx};
use wasmtime_wasi::{pipe::MemoryOutputPipe, DirPerms, FilePerms, WasiCtxBuilder};

const JS_RUNNER_WASM: &[u8] = include_bytes!("../wasm/js-runner.wasm");
const MAX_OUTPUT: usize = 1024 * 1024; // 1 MB
const FUEL_BUDGET: u64 = 1_000_000_000;

// ── Cached engine + module ────────────────────────────────────────────────────

struct JsRuntime {
    engine: Engine,
    module: Module,
    linker: Linker<WasiP1Ctx>,
}

unsafe impl Send for JsRuntime {}
unsafe impl Sync for JsRuntime {}

static JS_RUNTIME: OnceLock<JsRuntime> = OnceLock::new();

fn js_runtime() -> &'static JsRuntime {
    JS_RUNTIME.get_or_init(|| {
        let mut cfg = Config::new();
        cfg.consume_fuel(true);
        let engine = Engine::new(&cfg).expect("wasmtime engine");
        let module = Module::from_binary(&engine, JS_RUNNER_WASM).expect("js-runner.wasm compile");
        let mut linker: Linker<WasiP1Ctx> = Linker::new(&engine);
        preview1::add_to_linker_sync(&mut linker, |ctx| ctx).expect("wasi linker");
        JsRuntime { engine, module, linker }
    })
}

// ── Public API ────────────────────────────────────────────────────────────────

pub async fn run_in_wasm(
    language: &str,
    code: &str,
    mounts: Vec<PathBuf>,
) -> Result<Value, String> {
    match language {
        "javascript" | "js" => {
            let code = code.to_string();
            tokio::task::spawn_blocking(move || run_js(&code, &mounts))
                .await
                .map_err(|e| format!("task join: {e}"))?
        }
        "python" | "python3" => {
            let wasm_path = find_interpreter("micropython.wasm").ok_or(
                "Python unavailable: bundle micropython.wasm next to the executable".to_string(),
            )?;
            let code = code.to_string();
            tokio::task::spawn_blocking(move || {
                run_file(&wasm_path, &["micropython".into(), "-c".into(), code], &mounts)
            })
            .await
            .map_err(|e| format!("task join: {e}"))?
        }
        other => Err(format!(
            "unsupported language '{other}' (supported: javascript, python)"
        )),
    }
}

// ── Execution helpers ─────────────────────────────────────────────────────────

fn run_js(code: &str, mounts: &[PathBuf]) -> Result<Value, String> {
    let JsRuntime { engine, module, linker } = js_runtime();
    run_module(engine, module, linker, &["js-runner".into(), code.into()], mounts)
}

/// Synchronous JS execution for use from host functions inside another Wasmtime
/// store (where async is not available).  Reuses the cached `js_runtime()`.
pub fn run_js_blocking(code: &str, mounts: &[PathBuf]) -> Result<Value, String> {
    run_js(code, mounts)
}

/// Synchronous Python execution via `micropython.wasm`.
/// Returns `Err` if the interpreter binary is not bundled next to the executable.
pub fn run_python_blocking(code: &str, mounts: &[PathBuf]) -> Result<Value, String> {
    let wasm_path = find_interpreter("micropython.wasm").ok_or_else(|| {
        "Python unavailable: bundle micropython.wasm next to the executable".to_string()
    })?;
    run_file(&wasm_path, &["micropython".into(), "-c".into(), code.into()], mounts)
}

fn run_file(wasm_path: &Path, args: &[String], mounts: &[PathBuf]) -> Result<Value, String> {
    let mut cfg = Config::new();
    cfg.consume_fuel(true);
    let engine = Engine::new(&cfg).map_err(|e| format!("engine: {e}"))?;
    let module = Module::from_file(&engine, wasm_path)
        .map_err(|e| format!("load '{}': {e}", wasm_path.display()))?;
    let mut linker: Linker<WasiP1Ctx> = Linker::new(&engine);
    preview1::add_to_linker_sync(&mut linker, |ctx| ctx).map_err(|e| format!("linker: {e}"))?;
    run_module(&engine, &module, &linker, args, mounts)
}

fn run_module(
    engine: &Engine,
    module: &Module,
    linker: &Linker<WasiP1Ctx>,
    args: &[String],
    mounts: &[PathBuf],
) -> Result<Value, String> {
    let stdout = MemoryOutputPipe::new(MAX_OUTPUT);
    let stderr = MemoryOutputPipe::new(MAX_OUTPUT);

    let mut ctx = WasiCtxBuilder::new();
    ctx.stdout(stdout.clone()).stderr(stderr.clone()).args(args).inherit_env();

    for raw in mounts {
        if let Ok(canonical) = std::fs::canonicalize(raw) {
            let guest = canonical.to_string_lossy().into_owned();
            let _ = ctx.preopened_dir(&canonical, &guest, DirPerms::READ, FilePerms::READ);
        }
    }

    let mut store = Store::new(engine, ctx.build_p1());
    store.set_fuel(FUEL_BUDGET).map_err(|e| format!("set_fuel: {e}"))?;

    let instance = linker.instantiate(&mut store, module).map_err(|e| format!("instantiate: {e}"))?;

    let exit_code = match instance.get_typed_func::<(), ()>(&mut store, "_start") {
        Ok(start) => match start.call(&mut store, ()) {
            Ok(_) => 0i32,
            Err(trap) => {
                if let Some(exit) = trap.downcast_ref::<wasmtime_wasi::I32Exit>() {
                    exit.0
                } else if trap.to_string().contains("fuel") {
                    return Err("execution timed out".into());
                } else {
                    return Ok(json!({
                        "exit_code": 1,
                        "stdout": read_pipe(&stdout),
                        "stderr": format!("trap: {trap}"),
                    }));
                }
            }
        },
        Err(_) => return Err("wasm module has no '_start' entry point".into()),
    };

    Ok(json!({
        "exit_code": exit_code,
        "stdout": read_pipe(&stdout),
        "stderr": read_pipe(&stderr),
    }))
}

fn find_interpreter(name: &str) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from));
    exe_dir
        .into_iter()
        .flat_map(|d| [d.join(name), d.join("wasm").join(name)])
        .chain(std::iter::once(PathBuf::from(name)))
        .find(|p| p.exists())
}

fn read_pipe(pipe: &MemoryOutputPipe) -> String {
    String::from_utf8_lossy(&pipe.contents()).into_owned()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn js_console_log() {
        let r = run_in_wasm("javascript", "console.log('hello wasm')", vec![]).await.unwrap();
        assert_eq!(r["exit_code"], 0);
        assert_eq!(r["stdout"].as_str().unwrap().trim(), "hello wasm");
    }

    #[tokio::test]
    async fn js_arithmetic() {
        let r = run_in_wasm("javascript", "console.log(6 * 7)", vec![]).await.unwrap();
        assert_eq!(r["exit_code"], 0);
        assert_eq!(r["stdout"].as_str().unwrap().trim(), "42");
    }

    #[tokio::test]
    async fn js_syntax_error() {
        let r = run_in_wasm("javascript", "this is not valid js !!!", vec![]).await.unwrap();
        assert_eq!(r["exit_code"], 1);
        assert!(!r["stderr"].as_str().unwrap().is_empty());
    }

    #[tokio::test]
    async fn js_getenv() {
        let r = run_in_wasm("javascript", "console.log(typeof getenv('PATH'))", vec![]).await.unwrap();
        assert_eq!(r["exit_code"], 0);
        assert_eq!(r["stdout"].as_str().unwrap().trim(), "string");
    }
}
