//! jan-wasm-worker — child process for sandboxed JS execution.
//!
//! Reads JS code from stdin, executes it in wasmtime (js-runner.wasm),
//! prints JSON result to stdout, and exits.
//!
//! Memory is fully reclaimed by the OS when this process exits.

use serde_json::{json, Value};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use wasmtime::{Caller, Config, Engine, Extern, Linker, Module, Store};
use wasmtime_wasi::preview1::{self, WasiP1Ctx};
use wasmtime_wasi::{pipe::MemoryOutputPipe, WasiCtxBuilder};

const JS_RUNNER_WASM: &[u8] = include_bytes!("../../wasm/js-runner.wasm");
const MAX_OUTPUT: usize = 1024 * 1024;
const MAX_HTTP_BODY: usize = 256 * 1024;
const FUEL_BUDGET: u64 = 200_000_000;

fn main() {
    let code = {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf).unwrap_or(0);
        buf
    };

    match run_js(&code) {
        Ok(val) => {
            println!("{}", serde_json::to_string(&val).unwrap_or_default());
        }
        Err(e) => {
            let err = json!({"exit_code": 1, "stdout": "", "stderr": e});
            println!("{}", serde_json::to_string(&err).unwrap_or_default());
        }
    }
}

// ── Wasmtime execution ──────────────────────────────────────────────────────

fn shared_engine() -> &'static Engine {
    static ENGINE: OnceLock<Engine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        let mut cfg = Config::new();
        cfg.consume_fuel(true);
        Engine::new(&cfg).expect("wasmtime engine")
    })
}

fn http_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("jan-agent/0.1")
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    })
}

fn js_cache_path() -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    JS_RUNNER_WASM.len().hash(&mut h);
    JS_RUNNER_WASM[..4096.min(JS_RUNNER_WASM.len())].hash(&mut h);
    if JS_RUNNER_WASM.len() > 4096 {
        JS_RUNNER_WASM[JS_RUNNER_WASM.len() - 4096..].hash(&mut h);
    }
    let hash = h.finish();
    std::env::temp_dir()
        .join("jan-wasm-cache")
        .join(format!("js-runner-{hash:016x}.cwasm"))
}

fn load_js_module(engine: &Engine) -> Result<Module, String> {
    let cache = js_cache_path();

    if cache.is_file() {
        match unsafe { Module::deserialize_file(engine, &cache) } {
            Ok(m) => return Ok(m),
            Err(e) => {
                eprintln!("cached module stale/corrupt, recompiling: {e}");
                let _ = std::fs::remove_file(&cache);
            }
        }
    }

    let module = Module::from_binary(engine, JS_RUNNER_WASM)
        .map_err(|e| format!("js-runner.wasm compile: {e}"))?;

    match module.serialize() {
        Ok(bytes) => {
            if let Some(dir) = cache.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Err(e) = std::fs::write(&cache, &bytes) {
                eprintln!("failed to cache compiled module: {e}");
            }
        }
        Err(e) => eprintln!("failed to serialize module: {e}"),
    }

    Ok(module)
}

fn run_js(code: &str) -> Result<Value, String> {
    let engine = shared_engine();
    let module = load_js_module(engine)?;
    let mut linker: Linker<WasiP1Ctx> = Linker::new(engine);
    preview1::add_to_linker_sync(&mut linker, |ctx| ctx)
        .map_err(|e| format!("wasi linker: {e}"))?;
    register_host_imports(&mut linker)?;
    run_module(engine, &module, &linker, &["js-runner".into(), code.into()])
}

fn register_host_imports(linker: &mut Linker<WasiP1Ctx>) -> Result<(), String> {
    linker
        .func_wrap(
            "host",
            "http_get",
            |mut caller: Caller<'_, WasiP1Ctx>,
             url_ptr: i32, url_len: i32, buf_ptr: i32, buf_max: i32| -> i32 {
                let mem = match caller.get_export("memory") {
                    Some(Extern::Memory(m)) => m,
                    _ => return -1,
                };
                let url = {
                    let data = mem.data(&caller);
                    let start = url_ptr as usize;
                    let end = start + url_len as usize;
                    if end > data.len() { return -1; }
                    match std::str::from_utf8(&data[start..end]) {
                        Ok(s) => s.to_string(),
                        Err(_) => return -1,
                    }
                };
                let body = match http_client().get(&url).send() {
                    Ok(resp) => match resp.bytes() {
                        Ok(b) => b,
                        Err(_) => return -1,
                    },
                    Err(_) => return -1,
                };
                let write_len = body.len().min(buf_max as usize).min(MAX_HTTP_BODY);
                let data = mem.data_mut(&mut caller);
                let buf_start = buf_ptr as usize;
                if buf_start + write_len > data.len() { return -1; }
                data[buf_start..buf_start + write_len].copy_from_slice(&body[..write_len]);
                write_len as i32
            },
        )
        .map_err(|e| format!("host::http_get: {e}"))?;

    // Stub out read_file and write_file — the WASM module declares these imports
    // but they are no longer functional (always return -1 = error).
    linker
        .func_wrap("host", "read_file",
            |_caller: Caller<'_, WasiP1Ctx>,
             _: i32, _: i32, _: i32, _: i32| -> i32 { -1 })
        .map_err(|e| format!("host::read_file stub: {e}"))?;

    linker
        .func_wrap("host", "write_file",
            |_caller: Caller<'_, WasiP1Ctx>,
             _: i32, _: i32, _: i32, _: i32| -> i32 { -1 })
        .map_err(|e| format!("host::write_file stub: {e}"))?;

    Ok(())
}

fn run_module(
    engine: &Engine,
    module: &Module,
    linker: &Linker<WasiP1Ctx>,
    args: &[String],
) -> Result<Value, String> {
    let stdout = MemoryOutputPipe::new(MAX_OUTPUT);
    let stderr = MemoryOutputPipe::new(MAX_OUTPUT);

    let mut ctx = WasiCtxBuilder::new();
    ctx.stdout(stdout.clone()).stderr(stderr.clone()).args(args);
    // No inherit_env(), no preopened dirs — fully isolated sandbox.

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
                    return Err(
                        "execution timed out: the built-in JS engine is slow; retry with a \
                         smaller dataset, or start the microsandbox server \
                         (`msb server start --dev`) for full Node.js performance".into()
                    );
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

fn read_pipe(pipe: &MemoryOutputPipe) -> String {
    String::from_utf8_lossy(&pipe.contents()).into_owned()
}
