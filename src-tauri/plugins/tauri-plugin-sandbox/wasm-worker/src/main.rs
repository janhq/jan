//! jan-wasm-worker — child process for sandboxed execution.
//!
//! Two modes:
//!
//! 1. **JS mode** (default): reads JS code from stdin, runs via js-runner.wasm (Boa).
//! 2. **Skill mode** (`--skill <path.wasm>`): reads JSON args from stdin, calls
//!    the WASM skill's `run(ptr, len) → i64` export, prints JSON result to stdout.
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
const SKILL_FUEL_BUDGET: u64 = 1_000_000_000;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // --skill /path/to/tool.wasm  →  skill mode
    if args.len() >= 3 && args[1] == "--skill" {
        let wasm_path = &args[2];
        run_skill_mode(wasm_path);
    } else {
        run_js_mode();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// JS mode (existing behavior)
// ═══════════════════════════════════════════════════════════════════════════════

fn run_js_mode() {
    let code = {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf).unwrap_or(0);
        buf
    };

    match run_js(&code) {
        Ok(val) => println!("{}", serde_json::to_string(&val).unwrap_or_default()),
        Err(e) => {
            let err = json!({"exit_code": 1, "stdout": "", "stderr": e});
            println!("{}", serde_json::to_string(&err).unwrap_or_default());
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill mode — run a WASM skill tool via its run(ptr, len) → i64 ABI
// ═══════════════════════════════════════════════════════════════════════════════

fn run_skill_mode(wasm_path: &str) {
    let input = {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf).unwrap_or(0);
        buf
    };

    match run_skill(wasm_path, &input) {
        Ok((output, logs)) => {
            let result = json!({
                "output": output,
                "logs": logs,
            });
            println!("{}", serde_json::to_string(&result).unwrap_or_default());
        }
        Err(e) => {
            let err = json!({"error": e});
            println!("{}", serde_json::to_string(&err).unwrap_or_default());
        }
    }
}

/// Host state for skill WASM — collects log lines.
struct SkillHost {
    wasi: WasiP1Ctx,
    logs: Vec<String>,
}

fn run_skill(wasm_path: &str, input_json: &str) -> Result<(Value, Vec<String>), String> {
    let engine = shared_engine();
    let module = Module::from_file(engine, wasm_path)
        .map_err(|e| format!("compile {wasm_path}: {e}"))?;

    let mut linker: Linker<SkillHost> = Linker::new(engine);

    // WASI imports (skills compiled to wasm32-wasip1 pull in fd_write, etc.)
    preview1::add_to_linker_sync(&mut linker, |s: &mut SkillHost| &mut s.wasi)
        .map_err(|e| format!("wasi linker: {e}"))?;

    // host::log
    linker.func_wrap("host", "log",
        |mut caller: Caller<'_, SkillHost>, ptr: i32, len: i32| {
            let mem = match caller.get_export("memory") {
                Some(Extern::Memory(m)) => m,
                _ => return,
            };
            let clamped = (len as usize).min(4096);
            let start = ptr as usize;
            let msg: Option<String> = {
                let data = mem.data(&caller);
                if start.saturating_add(clamped) <= data.len() {
                    std::str::from_utf8(&data[start..start + clamped])
                        .ok().map(str::to_owned)
                } else {
                    None
                }
            };
            if let Some(s) = msg {
                if caller.data().logs.len() < 1000 {
                    caller.data_mut().logs.push(s);
                }
            }
        },
    ).map_err(|e| format!("host::log: {e}"))?;

    // host::http_get — same as JS mode but with SkillHost
    linker.func_wrap("host", "http_get",
        |mut caller: Caller<'_, SkillHost>,
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

            // Inject API keys from env vars (same as executor.rs)
            let mut req = http_client().get(&url);
            if url.contains("api.search.brave.com") {
                if let Ok(key) = std::env::var("BRAVE_API_KEY") {
                    req = req.header("X-Subscription-Token", key);
                }
                req = req.header("Accept", "application/json");
            } else if url.contains("html.duckduckgo.com") {
                req = req.header("User-Agent",
                    "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0");
            }

            let body = match req.send().and_then(|r| r.bytes()) {
                Ok(b) => b.to_vec(),
                Err(_) => return -1,
            };
            let write_len = body.len().min(buf_max as usize).min(MAX_HTTP_BODY);
            let data = mem.data_mut(&mut caller);
            let buf_start = buf_ptr as usize;
            if buf_start + write_len > data.len() { return -1; }
            data[buf_start..buf_start + write_len].copy_from_slice(&body[..write_len]);
            write_len as i32
        },
    ).map_err(|e| format!("host::http_get: {e}"))?;

    // Create store with empty WASI context (no env, no filesystem)
    let wasi = WasiCtxBuilder::new().build_p1();
    let mut store = Store::new(engine, SkillHost { wasi, logs: Vec::new() });
    store.set_fuel(SKILL_FUEL_BUDGET).map_err(|e| format!("set_fuel: {e}"))?;

    let instance = linker.instantiate(&mut store, &module)
        .map_err(|e| format!("instantiate: {e}"))?;
    let memory = instance.get_memory(&mut store, "memory")
        .ok_or("skill must export 'memory'")?;
    let run_fn = instance.get_typed_func::<(i32, i32), i64>(&mut store, "run")
        .map_err(|_| "skill must export 'run(i32, i32) -> i64'")?;

    // Write input JSON to guest memory at offset 0
    let input_bytes = input_json.as_bytes();
    memory.write(&mut store, 0, input_bytes)
        .map_err(|e| format!("write input: {e}"))?;

    // Call run(ptr=0, len=input_len) → packed (out_ptr << 32 | out_len)
    let packed = run_fn.call(&mut store, (0, input_bytes.len() as i32))
        .map_err(|e| {
            if e.to_string().contains("fuel") {
                "skill exceeded CPU budget (fuel exhausted)".to_string()
            } else {
                format!("run() failed: {e}")
            }
        })?;

    let out_ptr = ((packed >> 32) & 0xFFFF_FFFF) as usize;
    let out_len = (packed & 0xFFFF_FFFF) as usize;

    let mut out_buf = vec![0u8; out_len];
    memory.read(&store, out_ptr, &mut out_buf)
        .map_err(|e| format!("read output: {e}"))?;

    let output: Value = serde_json::from_slice(&out_buf)
        .map_err(|e| format!("skill returned invalid JSON: {e}"))?;

    let logs = store.into_data().logs;
    Ok((output, logs))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared engine + HTTP client
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// JS mode internals
// ═══════════════════════════════════════════════════════════════════════════════

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
    register_js_host_imports(&mut linker)?;
    run_module(engine, &module, &linker, &["js-runner".into(), code.into()])
}

fn register_js_host_imports(linker: &mut Linker<WasiP1Ctx>) -> Result<(), String> {
    linker
        .func_wrap("host", "http_get",
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

    linker
        .func_wrap("host", "read_file",
            |_: Caller<'_, WasiP1Ctx>, _: i32, _: i32, _: i32, _: i32| -> i32 { -1 })
        .map_err(|e| format!("host::read_file stub: {e}"))?;

    linker
        .func_wrap("host", "write_file",
            |_: Caller<'_, WasiP1Ctx>, _: i32, _: i32, _: i32, _: i32| -> i32 { -1 })
        .map_err(|e| format!("host::write_file stub: {e}"))?;

    Ok(())
}

fn run_module(
    engine: &Engine, module: &Module, linker: &Linker<WasiP1Ctx>, args: &[String],
) -> Result<Value, String> {
    let stdout = MemoryOutputPipe::new(MAX_OUTPUT);
    let stderr = MemoryOutputPipe::new(MAX_OUTPUT);

    let mut ctx = WasiCtxBuilder::new();
    ctx.stdout(stdout.clone()).stderr(stderr.clone()).args(args);

    let mut store = Store::new(engine, ctx.build_p1());
    store.set_fuel(FUEL_BUDGET).map_err(|e| format!("set_fuel: {e}"))?;

    let instance = linker.instantiate(&mut store, module)
        .map_err(|e| format!("instantiate: {e}"))?;

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
