//! HTTP fetch WASM skill — GET or POST any URL.
//!
//! # Build
//! ```sh
//! cargo build --target wasm32-wasip1 --release
//! cp target/wasm32-wasip1/release/http_fetch_tool.wasm \
//!    ../../wasm/skills/http/fetch.wasm
//! ```
//!
//! Input JSON:  `{ "url": "https://...", "method": "GET" }`
//! Output JSON: `{ "url": "...", "status": 200, "body": "...", "truncated": false }`

#[link(wasm_import_module = "host")]
extern "C" {
    fn log(ptr: i32, len: i32);
    fn http_get(url_ptr: i32, url_len: i32, buf_ptr: i32, buf_max: i32) -> i32;
}

const HTTP_BUF_MAX: usize = 256 * 1024;
static mut HTTP_BUF: [u8; HTTP_BUF_MAX] = [0u8; HTTP_BUF_MAX];
static mut OUTPUT: Vec<u8> = Vec::new();

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
        Ok(v) => v,
        Err(e) => return error_json(&format!("invalid params: {e}")),
    };

    let url = match params["url"].as_str() {
        Some(u) if !u.is_empty() => u.to_owned(),
        _ => return error_json("'url' is required"),
    };

    // Only GET is supported via host::http_get for now.
    // POST support can be added when the host provides host::http_post.
    let method = params["method"].as_str().unwrap_or("GET").to_uppercase();
    if method != "GET" {
        return error_json("only GET is supported in this WASM version; use the native http.fetch for POST");
    }

    host_log(&format!("http.fetch: GET {url}"));

    let n = unsafe {
        http_get(
            url.as_ptr() as i32,
            url.len() as i32,
            HTTP_BUF.as_ptr() as i32,
            HTTP_BUF_MAX as i32,
        )
    };

    if n < 0 {
        return error_json(&format!("http_get failed for {url}"));
    }

    let body_bytes = unsafe { &HTTP_BUF[..n as usize] };
    let body = String::from_utf8_lossy(body_bytes);

    // Truncate before sending to the model.
    const MAX_BODY: usize = 32 * 1024;
    let truncated = body.len() > MAX_BODY;
    let body_out  = if truncated { &body[..MAX_BODY] } else { &body };

    let output = serde_json::json!({
        "url":       url,
        "status":    200,   // host::http_get doesn't expose status codes yet
        "body":      body_out,
        "truncated": truncated,
    });

    serde_json::to_vec(&output).unwrap_or_else(|_| b"{}".to_vec())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn host_log(msg: &str) { unsafe { log(msg.as_ptr() as i32, msg.len() as i32) } }

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
    "Fetch any URL via HTTP GET and return the response body (truncated to 32 KB). \
     Use for REST APIs, JSON endpoints, or raw web pages.";

const SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "Full URL to fetch (https://...)"
    },
    "method": {
      "type": "string",
      "enum": ["GET"],
      "default": "GET",
      "description": "HTTP method (GET only in WASM version)"
    }
  },
  "required": ["url"],
  "additionalProperties": false
}"#;
