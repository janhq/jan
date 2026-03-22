//! WASM sandbox for untrusted code execution.
//!
//! Uses js-runner.wasm (Boa) as the JS engine.
//!
//! ## Memory model
//!
//! JS execution runs in a **child process** (`jan-wasm-worker`).
//! The child loads the WASM module, runs the JS, prints JSON to
//! stdout, and exits.  When the child exits, the OS reclaims **all** memory.
//!
//! The parent process never links wasmtime, keeping RSS under 5 MB.

use serde_json::{json, Value};
use std::io::Write as _;
use std::path::PathBuf;

#[cfg(feature = "wasmtime-runtime")]
const MAX_OUTPUT: usize = 1024 * 1024; // 1 MB

// ── Subprocess-based execution (parent process — no wasmtime) ─────────────────

/// Find the jan-wasm-worker binary.
fn find_wasm_worker() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let dir = exe.parent().unwrap_or(std::path::Path::new("."));

    let candidates = [
        // Next to the current binary (production + dev when copied)
        dir.join("jan-wasm-worker"),
        // macOS app bundle
        dir.join("../Resources/bin/jan-wasm-worker"),
    ];

    for c in &candidates {
        if c.is_file() {
            return Ok(c.clone());
        }
    }

    // Try PATH
    if let Ok(p) = which::which("jan-wasm-worker") {
        return Ok(p);
    }

    Err(format!(
        "jan-wasm-worker not found. Build it with:\n  \
         cd plugins/tauri-plugin-sandbox && cargo build --features wasmtime-runtime --bin jan-wasm-worker\n  \
         cp target/debug/jan-wasm-worker ../../target/debug/"
    ))
}

fn run_js(code: &str, mounts: &[PathBuf]) -> Result<Value, String> {
    let worker = find_wasm_worker()?;

    let mut cmd = std::process::Command::new(&worker);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // Pass mount paths via env var (colon-separated)
    if !mounts.is_empty() {
        let mounts_str: String = mounts
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(":");
        cmd.env("JAN_WASM_MOUNTS", mounts_str);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn wasm worker: {e}"))?;

    // Write code to child's stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(code.as_bytes())
            .map_err(|e| format!("write stdin: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("wait wasm worker: {e}"))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let stderr_str = String::from_utf8_lossy(&output.stderr);

    // Parse JSON from stdout (the child prints the result JSON)
    if let Ok(val) = serde_json::from_str::<Value>(stdout_str.trim()) {
        return Ok(val);
    }

    // If we can't parse JSON, wrap raw output
    let exit_code = output.status.code().unwrap_or(1);
    Ok(json!({
        "exit_code": exit_code,
        "stdout": stdout_str.trim(),
        "stderr": stderr_str.trim(),
    }))
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
            Err("Python via WASM subprocess not yet supported".into())
        }
        other => Err(format!(
            "unsupported language '{other}' (supported: javascript, python)"
        )),
    }
}

/// Synchronous JS execution via subprocess.
pub fn run_js_blocking(code: &str, mounts: &[PathBuf]) -> Result<Value, String> {
    run_js(code, mounts)
}

// ── In-process wasmtime execution (only compiled with wasmtime-runtime feature) ──

#[cfg(feature = "wasmtime-runtime")]
pub mod worker {
    use super::*;
    use std::sync::OnceLock;
    use std::time::Duration;
    use wasmtime::{Caller, Config, Engine, Extern, Linker, Module, Store};
    use wasmtime_wasi::preview1::{self, WasiP1Ctx};
    use wasmtime_wasi::{pipe::MemoryOutputPipe, DirPerms, FilePerms, WasiCtxBuilder};

    const JS_RUNNER_WASM: &[u8] = include_bytes!("../wasm/js-runner.wasm");
    const MAX_HTTP_BODY: usize = 256 * 1024;
    const FUEL_BUDGET: u64 = 200_000_000;

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
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        JS_RUNNER_WASM.len().hash(&mut h);
        JS_RUNNER_WASM[..4096.min(JS_RUNNER_WASM.len())].hash(&mut h);
        if JS_RUNNER_WASM.len() > 4096 {
            JS_RUNNER_WASM[JS_RUNNER_WASM.len() - 4096..].hash(&mut h);
        }
        let hash = h.finish();
        let dir = std::env::temp_dir().join("jan-wasm-cache");
        dir.join(format!("js-runner-{hash:016x}.cwasm"))
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

    pub fn run_js_inprocess(code: &str, mounts: &[PathBuf]) -> Result<Value, String> {
        let engine = shared_engine();
        let module = load_js_module(engine)?;
        let mut linker: Linker<WasiP1Ctx> = Linker::new(engine);
        preview1::add_to_linker_sync(&mut linker, |ctx| ctx)
            .map_err(|e| format!("wasi linker: {e}"))?;
        register_host_imports(&mut linker)?;
        run_module(engine, &module, &linker, &["js-runner".into(), code.into()], mounts)
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

        linker
            .func_wrap(
                "host",
                "read_file",
                |mut caller: Caller<'_, WasiP1Ctx>,
                 path_ptr: i32, path_len: i32, buf_ptr: i32, buf_max: i32| -> i32 {
                    let mem = match caller.get_export("memory") {
                        Some(Extern::Memory(m)) => m,
                        _ => return -1,
                    };
                    let path = {
                        let data = mem.data(&caller);
                        let start = path_ptr as usize;
                        let end = start + path_len as usize;
                        if end > data.len() { return -1; }
                        match std::str::from_utf8(&data[start..end]) {
                            Ok(s) => s.to_string(),
                            Err(_) => return -1,
                        }
                    };
                    let path = if path.starts_with("~/") {
                        let home = std::env::var("HOME")
                            .or_else(|_| std::env::var("USERPROFILE"))
                            .unwrap_or_else(|_| "/".into());
                        std::path::PathBuf::from(home).join(&path[2..])
                    } else {
                        std::path::PathBuf::from(&path)
                    };
                    match std::fs::read(&path) {
                        Ok(content) => {
                            let write_len = content.len().min(buf_max as usize);
                            let data = mem.data_mut(&mut caller);
                            let buf_start = buf_ptr as usize;
                            if buf_start + write_len > data.len() { return -1; }
                            data[buf_start..buf_start + write_len]
                                .copy_from_slice(&content[..write_len]);
                            write_len as i32
                        }
                        Err(_) => -1,
                    }
                },
            )
            .map_err(|e| format!("host::read_file: {e}"))?;

        linker
            .func_wrap(
                "host",
                "write_file",
                |mut caller: Caller<'_, WasiP1Ctx>,
                 path_ptr: i32, path_len: i32, data_ptr: i32, data_len: i32| -> i32 {
                    let mem = match caller.get_export("memory") {
                        Some(Extern::Memory(m)) => m,
                        _ => return -1,
                    };
                    let (path, content) = {
                        let data = mem.data(&caller);
                        let path_start = path_ptr as usize;
                        let path_end = path_start + path_len as usize;
                        let data_start = data_ptr as usize;
                        let data_end = data_start + data_len as usize;
                        if path_end > data.len() || data_end > data.len() { return -1; }
                        let path = match std::str::from_utf8(&data[path_start..path_end]) {
                            Ok(s) => s.to_string(),
                            Err(_) => return -1,
                        };
                        let content = data[data_start..data_end].to_vec();
                        (path, content)
                    };
                    let path = if path.starts_with("~/") {
                        let home = std::env::var("HOME")
                            .or_else(|_| std::env::var("USERPROFILE"))
                            .unwrap_or_else(|_| "/".into());
                        std::path::PathBuf::from(home).join(&path[2..])
                    } else {
                        std::path::PathBuf::from(&path)
                    };
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    match std::fs::write(&path, &content) {
                        Ok(_) => content.len() as i32,
                        Err(_) => -1,
                    }
                },
            )
            .map_err(|e| format!("host::write_file: {e}"))?;

        Ok(())
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

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn js_console_log() {
            let r = run_js_inprocess("console.log('hello wasm')", &[]).unwrap();
            assert_eq!(r["exit_code"], 0);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "hello wasm");
        }

        #[test]
        fn js_arithmetic() {
            let r = run_js_inprocess("console.log(6 * 7)", &[]).unwrap();
            assert_eq!(r["exit_code"], 0);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "42");
        }

        #[test]
        fn js_syntax_error() {
            let r = run_js_inprocess("this is not valid js !!!", &[]).unwrap();
            assert_eq!(r["exit_code"], 1);
            assert!(!r["stderr"].as_str().unwrap().is_empty());
        }

        #[test]
        fn js_getenv() {
            let r = run_js_inprocess("console.log(typeof getenv('PATH'))", &[]).unwrap();
            assert_eq!(r["exit_code"], 0);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "string");
        }

        #[test]
        fn js_date_now() {
            let r = run_js_inprocess("console.log(Date.now() > 0)", &[]).unwrap();
            assert_eq!(r["exit_code"], 0);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "true");
        }

        #[test]
        fn js_performance_now() {
            let r = run_js_inprocess("console.log(performance.now() > 0)", &[]).unwrap();
            assert_eq!(r["exit_code"], 0);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "true");
        }

        #[test]
        fn js_http_get() {
            let code = r#"
                var body = httpGet("https://hacker-news.firebaseio.com/v0/item/1.json");
                var item = JSON.parse(body);
                console.log(item.by);
            "#;
            let r = run_js_inprocess(code, &[]).unwrap();
            assert_eq!(r["exit_code"], 0, "stderr: {}", r["stderr"]);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "pg");
        }

        #[test]
        fn js_tool_pattern() {
            let code = r#"
                var __args = {"name": "world"};
                function run(args) {
                    return { greeting: "hello " + args.name };
                }
                var __result = run(__args);
                console.log(JSON.stringify(__result));
            "#;
            let r = run_js_inprocess(code, &[]).unwrap();
            assert_eq!(r["exit_code"], 0, "stderr: {}", r["stderr"]);
            let stdout = r["stdout"].as_str().unwrap().trim();
            let parsed: serde_json::Value = serde_json::from_str(stdout).unwrap();
            assert_eq!(parsed["greeting"], "hello world");
        }

        #[test]
        fn js_write_and_read_file() {
            let tmp = std::env::temp_dir().join("jan_test_wasm_rw.txt");
            let tmp_path = tmp.display().to_string();
            let code = format!(
                r#"writeFile("{path}", "hello from wasm");
                var content = readFile("{path}");
                console.log(content);"#,
                path = tmp_path
            );
            let r = run_js_inprocess(&code, &[]).unwrap();
            assert_eq!(r["exit_code"], 0, "stderr: {}", r["stderr"]);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "hello from wasm");
            let _ = std::fs::remove_file(&tmp);
        }

        #[test]
        fn js_format_date() {
            let code = r#"console.log(formatDate(1704067200000))"#;
            let r = run_js_inprocess(code, &[]).unwrap();
            assert_eq!(r["exit_code"], 0, "stderr: {}", r["stderr"]);
            assert_eq!(r["stdout"].as_str().unwrap().trim(), "2024-01-01T00:00:00Z");
        }
    }
}
