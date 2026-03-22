//! jan-wasm-worker — child process for sandboxed JS execution.
//!
//! Reads JS code from stdin, executes it in wasmtime (js-runner.wasm),
//! prints JSON result to stdout, and exits.
//!
//! Memory is fully reclaimed by the OS when this process exits.

fn main() {
    let code = {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf).unwrap_or(0);
        buf
    };

    let mounts: Vec<std::path::PathBuf> = std::env::var("JAN_WASM_MOUNTS")
        .unwrap_or_default()
        .split(':')
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .collect();

    let result = tauri_plugin_sandbox::wasm_runtime::worker::run_js_inprocess(&code, &mounts);

    match result {
        Ok(val) => {
            println!("{}", serde_json::to_string(&val).unwrap_or_default());
        }
        Err(e) => {
            let err = serde_json::json!({
                "exit_code": 1,
                "stdout": "",
                "stderr": e,
            });
            println!("{}", serde_json::to_string(&err).unwrap_or_default());
        }
    }
}
