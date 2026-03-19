//! code.exec WASM skill.
//!
//! Parses `{"language": "...", "code": "..."}` and delegates actual execution
//! to the host via `host::exec_code`.  The host runs js-runner.wasm (QuickJS)
//! or micropython.wasm in its own isolated sandbox with the caller's mounts.
//!
//! # Build
//! ```sh
//! cargo build --target wasm32-wasip1 --release
//! cp target/wasm32-wasip1/release/code_exec_tool.wasm ../../wasm/skills/code/exec.wasm
//! ```

// ── Host imports ──────────────────────────────────────────────────────────────

#[link(wasm_import_module = "host")]
extern "C" {
    fn log(ptr: i32, len: i32);

    /// Execute code in the host runtime and write the JSON result to `out_buf`.
    ///
    /// `ws_ptr/ws_len` — workspace ID (UTF-8).  Pass 0/0 for ephemeral execution.
    ///
    /// Ephemeral result:  `{"exit_code": 0, "stdout": "...", "stderr": "..."}`
    /// Workspace result:  same, plus `"url": "http://localhost:N"` when a server
    ///                    is detected on the workspace's mapped port.
    ///
    /// Returns bytes written (≥0) or -1 if the language is unsupported or the
    /// runtime is unavailable.
    fn exec_code(
        lang_ptr: i32, lang_len: i32,
        code_ptr: i32, code_len: i32,
        ws_ptr:   i32, ws_len:   i32,
        out_ptr:  i32, out_max:  i32,
    ) -> i32;
}

// ── Static buffers ────────────────────────────────────────────────────────────

const OUT_MAX: usize = 256 * 1024;

static mut OUTPUT:     Vec<u8>         = Vec::new();
static mut RESULT_BUF: [u8; OUT_MAX]   = [0u8; OUT_MAX];

// ── Tool exports ──────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn description() -> i64 { str_to_packed(DESCRIPTION) }

#[no_mangle]
pub extern "C" fn schema() -> i64 { str_to_packed(SCHEMA) }

#[no_mangle]
pub extern "C" fn run(input_ptr: i32, input_len: i32) -> i64 {
    let input = unsafe {
        core::slice::from_raw_parts(input_ptr as *const u8, input_len as usize)
    };
    let result = execute(input);
    unsafe {
        OUTPUT = result;
        vec_to_packed(&OUTPUT)
    }
}

// ── Execution ─────────────────────────────────────────────────────────────────

fn execute(input: &[u8]) -> Vec<u8> {
    let params: serde_json::Value = match serde_json::from_slice(input) {
        Ok(v)  => v,
        Err(e) => return error_json(&format!("invalid params: {e}")),
    };

    let language = params["language"].as_str().unwrap_or("javascript");
    let code = match params["code"].as_str() {
        Some(c) if !c.is_empty() => c,
        _ => return error_json("'code' is required"),
    };

    // Optional workspace ID — empty string means ephemeral.
    let workspace = params["workspace"].as_str().unwrap_or("");

    host_log(&format!(
        "code.exec: language={language} ({} bytes) workspace={:?}",
        code.len(),
        if workspace.is_empty() { "ephemeral" } else { workspace }
    ));

    let n = unsafe {
        exec_code(
            language.as_ptr()  as i32, language.len()  as i32,
            code.as_ptr()      as i32, code.len()      as i32,
            workspace.as_ptr() as i32, workspace.len() as i32,
            RESULT_BUF.as_ptr() as i32, OUT_MAX as i32,
        )
    };

    if n < 0 {
        return error_json(
            &format!("'{language}' runtime unavailable — bundle js-runner.wasm or micropython.wasm"),
        );
    }

    unsafe { RESULT_BUF[..n as usize].to_vec() }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn host_log(msg: &str) {
    unsafe { log(msg.as_ptr() as i32, msg.len() as i32) }
}

fn error_json(msg: &str) -> Vec<u8> {
    host_log(&format!("error: {msg}"));
    format!(r#"{{"error":"{msg}"}}"#).into_bytes()
}

fn str_to_packed(s: &'static str) -> i64 {
    (s.as_ptr() as i64) << 32 | s.len() as i64
}

fn vec_to_packed(v: &[u8]) -> i64 {
    (v.as_ptr() as i64) << 32 | v.len() as i64
}

// ── Metadata ──────────────────────────────────────────────────────────────────

const DESCRIPTION: &str =
    "Execute code in an isolated sandbox (microVM or WASM fallback).\n\
     \n\
     EPHEMERAL (no workspace): fast, stateless, destroyed after each call.\n\
     WORKSPACE (workspace set): persistent VM — filesystem and processes survive \
     between calls. Use the same workspace ID across calls to build a project. \
     If the code starts a server on port 3000 the response includes a 'url' field \
     with the exposed address.\n\
     \n\
     Languages: 'javascript' (full Node.js, npm available in workspace), 'python', 'bash'.\n\
     For servers, listen on port 3000.";

const SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "language": {
      "type": "string",
      "enum": ["javascript", "python", "bash"],
      "description": "Runtime to use. All three are available in a workspace; ephemeral mode supports 'javascript' only."
    },
    "code": {
      "type": "string",
      "description": "Code to execute. JS: use console.log(). Servers: listen on port 3000."
    },
    "workspace": {
      "type": "string",
      "description": "Persistent workspace ID. Omit for ephemeral one-shot execution. Use the same ID across calls to share filesystem state. Destroyed when the session ends."
    }
  },
  "required": ["language", "code"],
  "additionalProperties": false
}"#;
