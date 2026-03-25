//! Tool dispatcher — routes tool calls to WASM skill tools, code.exec, and JS tools.
//!
//! ## WASM skill tools (from `tools/` directory)
//! Pre-compiled `.wasm` binaries from `tools-src/`. Metadata read from sidecar
//! `.json` files. Executed via `jan-wasm-worker --skill` subprocess so that all
//! wasmtime memory is reclaimed when the child process exits.
//!
//! ## code.exec (built-in)
//! Runs arbitrary user code — microsandbox first, WASM fallback for JS.
//!
//! ## JS tools (user-created, `~/.jan/tools/`)
//! Plain `.js` files with `// @tool` metadata.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::{DispatchResult, ToolDispatcher, ToolMeta};

// ── Tool types ───────────────────────────────────────────────────────────────

struct WasmTool {
    id:   String,
    path: PathBuf,
    meta: ToolMeta,
}

struct JsTool {
    id:     String,
    source: String,
    meta:   ToolMeta,
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/// Optional callback for robot movement commands.
/// Receives the direction and distance; returns Ok(description) or Err.
pub type RobotCommandHandler = Box<dyn Fn(&str, f64) -> Result<String, String> + Send + Sync>;

pub struct Dispatcher {
    pub(crate) mounts:  Vec<PathBuf>,
    wasm_tools:         Vec<WasmTool>,
    js_tools:           RwLock<Vec<JsTool>>,
    /// When set, robot.* tools are registered and dispatched.
    robot_handler:      Option<RobotCommandHandler>,
    /// When set, robot commands are dispatched via async HTTP instead of
    /// the sync handler (avoids blocking the tokio runtime).
    robot_http_url:     Option<String>,
    robot_http_client:  Option<reqwest::Client>,
}

impl Dispatcher {
    pub fn new() -> Self {
        Self {
            mounts: vec![], wasm_tools: vec![], js_tools: RwLock::new(vec![]),
            robot_handler: None, robot_http_url: None, robot_http_client: None,
        }
    }

    /// Load WASM skill tools from `tools_dir`.
    /// Reads metadata from sidecar `.json` files (no wasmtime needed).
    pub fn with_tools_dir(mut self, tools_dir: PathBuf) -> Self {
        if !tools_dir.is_dir() {
            log::info!("[dispatcher] tools dir not found: {}", tools_dir.display());
            return self;
        }
        self.wasm_tools = scan_wasm_tools(&tools_dir);
        log::info!(
            "[dispatcher] loaded {} WASM tools from {}",
            self.wasm_tools.len(), tools_dir.display()
        );
        self
    }

    pub fn with_mounts(mut self, mounts: Vec<PathBuf>) -> Self {
        self.mounts = mounts;
        self
    }

    pub fn with_user_tools_dir(mut self, dir: PathBuf) -> Self {
        if dir.is_dir() {
            let tools = scan_js_tools_dir(&dir);
            log::info!("[dispatcher] loaded {} JS tools from {}", tools.len(), dir.display());
            self.js_tools = RwLock::new(tools);
        }
        self
    }

    /// Enable robot control tools (WASD movement).
    ///
    /// The handler receives `(direction, distance)` and should return a status message.
    /// If no handler is given, a default logging handler is used.
    pub fn with_robot_tools(mut self, handler: Option<RobotCommandHandler>) -> Self {
        self.robot_handler = Some(handler.unwrap_or_else(|| {
            Box::new(|direction, distance| {
                log::info!("[robot] {direction} {distance:.2}m");
                Ok(format!("Moved {direction} {distance:.2}m"))
            })
        }));
        self
    }

    /// Enable robot control tools via an async HTTP backend (e.g. ProcTHOR server).
    ///
    /// This is preferred over `with_robot_tools` + `http_robot_handler` because
    /// it performs HTTP calls asynchronously inside the `dispatch` method,
    /// avoiding any blocking of the tokio runtime.
    pub fn with_robot_http(mut self, base_url: String) -> Self {
        self.robot_http_url = Some(base_url);
        self.robot_http_client = Some(reqwest::Client::new());
        // Also register a dummy sync handler so tool_schemas includes robot tools
        self.robot_handler = Some(Box::new(|d, dist| {
            Ok(format!("{d} {dist:.2}m (http)"))
        }));
        self
    }
}

#[async_trait::async_trait]
impl ToolDispatcher for Dispatcher {
    fn tool_schemas(&self) -> Vec<ToolMeta> {
        let mut schemas: Vec<ToolMeta> = Vec::new();
        for wt in &self.wasm_tools {
            schemas.push(wt.meta.clone());
        }
        schemas.push(code_exec_meta());
        if let Ok(js) = self.js_tools.read() {
            schemas.extend(js.iter().map(|jt| jt.meta.clone()));
        }
        if self.robot_handler.is_some() {
            schemas.extend(robot_tool_metas());
        }
        schemas
    }

    async fn dispatch(&self, tool_id: &str, args: Value) -> Result<DispatchResult, String> {
        log::info!("[dispatcher] tool={tool_id}");

        if tool_id == "code.exec" {
            return dispatch_code_exec(args, &self.mounts).await;
        }

        // Robot control tools
        if tool_id.starts_with("robot.") {
            // Prefer async HTTP dispatch when configured
            if let (Some(ref base_url), Some(ref client)) = (&self.robot_http_url, &self.robot_http_client) {
                return dispatch_robot_http(tool_id, args, base_url, client).await;
            }
            if let Some(ref handler) = self.robot_handler {
                return dispatch_robot_tool(tool_id, args, handler);
            }
            return Err("robot tools not enabled".into());
        }

        if let Some(wt) = self.wasm_tools.iter().find(|w| w.id == tool_id) {
            return dispatch_wasm_skill(&wt.path, args).await;
        }

        let js_source = {
            let js = self.js_tools.read().map_err(|e| format!("lock: {e}"))?;
            js.iter().find(|j| j.id == tool_id).map(|jt| jt.source.clone())
        };
        if let Some(source) = js_source {
            return dispatch_js_tool(&source, args, &self.mounts).await;
        }

        Err(format!("unknown tool: '{tool_id}'"))
    }
}

// ── WASM skill dispatch (subprocess — no in-process wasmtime) ────────────────

/// Execute a WASM skill tool via `jan-wasm-worker --skill <path>`.
///
/// The subprocess loads wasmtime, runs the skill, prints JSON, and exits.
/// All wasmtime memory is reclaimed by the OS when the child exits.
async fn dispatch_wasm_skill(wasm_path: &Path, args: Value) -> Result<DispatchResult, String> {
    let path = wasm_path.to_path_buf();
    let input = serde_json::to_string(&args).unwrap_or_else(|_| "{}".into());

    let result = tokio::task::spawn_blocking(move || {
        run_wasm_worker_skill(&path, &input)
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?;

    result
}

/// Find jan-wasm-worker and run it in --skill mode.
fn run_wasm_worker_skill(wasm_path: &Path, input_json: &str) -> Result<DispatchResult, String> {
    let worker = tauri_plugin_sandbox::wasm_runtime::find_wasm_worker()?;

    let mut cmd = std::process::Command::new(&worker);
    cmd.arg("--skill").arg(wasm_path);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // Pass through API keys so the worker's host::http_get can inject them
    for var in &["BRAVE_API_KEY"] {
        if let Ok(val) = std::env::var(var) {
            cmd.env(var, val);
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn wasm worker: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(input_json.as_bytes())
            .map_err(|e| format!("write stdin: {e}"))?;
    }

    let output = child.wait_with_output()
        .map_err(|e| format!("wait wasm worker: {e}"))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);

    let result: Value = serde_json::from_str(stdout_str.trim())
        .map_err(|e| format!("parse worker output: {e}\nraw: {}", stdout_str.chars().take(200).collect::<String>()))?;

    if let Some(err) = result["error"].as_str() {
        return Err(err.to_string());
    }

    let tool_output = result["output"].clone();
    let logs: Vec<String> = result["logs"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    Ok(DispatchResult { output: tool_output, wasm_logs: logs })
}

// ── WASM tool scanning ───────────────────────────────────────────────────────

fn scan_wasm_tools(tools_dir: &Path) -> Vec<WasmTool> {
    let mut tools = Vec::new();
    scan_wasm_dir(tools_dir, tools_dir, &mut tools);
    tools
}

fn scan_wasm_dir(base: &Path, dir: &Path, out: &mut Vec<WasmTool>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e)  => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            scan_wasm_dir(base, &path, out);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("wasm") {
            continue;
        }

        // Derive tool ID from relative path: web/search.wasm → web.search
        let rel = path.strip_prefix(base).unwrap_or(&path);
        let id = rel.with_extension("")
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(".");

        // Read metadata from sidecar .json (no wasmtime needed in parent process)
        let json_path = path.with_extension("json");
        if let Some(meta) = load_json_meta(&json_path, &id) {
            log::info!("[dispatcher] loaded WASM tool '{id}' from {}", path.display());
            out.push(WasmTool { id, path, meta });
        } else {
            log::info!("[dispatcher] skipping '{}': no sidecar .json metadata", path.display());
        }
    }
}

fn load_json_meta(json_path: &Path, id: &str) -> Option<ToolMeta> {
    let data = std::fs::read_to_string(json_path).ok()?;
    let v: Value = serde_json::from_str(&data).ok()?;
    Some(ToolMeta {
        id:          id.to_string(),
        description: v["description"].as_str().unwrap_or("").to_string(),
        parameters:  v["parameters"].clone(),
    })
}

// ── code.exec builtin ────────────────────────────────────────────────────────

fn code_exec_meta() -> ToolMeta {
    ToolMeta {
        id:          "code.exec".into(),
        description: "Execute code in an isolated sandbox. \
                      Supports 'javascript' (default), 'python', and 'bash'. \
                      No filesystem or environment access in ephemeral mode. \
                      JS APIs: console.log(), httpGet(url), fetch(url), Date.now(), JSON, Math. \
                      Python: full stdlib available. \
                      Bash: common unix tools. \
                      Use 'workspace' parameter to persist state across calls (files, servers, npm packages)."
            .into(),
        parameters:  serde_json::json!({
            "type": "object",
            "properties": {
                "language": {
                    "type": "string",
                    "enum": ["javascript", "python", "bash"],
                    "description": "Runtime to use (default: javascript)"
                },
                "code": {
                    "type": "string",
                    "description": "Code to execute. JS: console.log(). Python: print(). Bash: stdout."
                },
                "workspace": {
                    "type": "string",
                    "description": "Persistent workspace ID. Omit for ephemeral one-shot execution. Use same ID across calls to share filesystem state."
                }
            },
            "required": ["code"]
        }),
    }
}

async fn dispatch_code_exec(args: Value, mounts: &[PathBuf]) -> Result<DispatchResult, String> {
    let code = args["code"].as_str().ok_or("code.exec: missing 'code'")?;
    let language = args["language"].as_str().unwrap_or("javascript");
    let workspace = args["workspace"].as_str().filter(|s| !s.is_empty());

    log::info!("[code.exec] language={language} workspace={workspace:?} ({} bytes)", code.len());
    log::info!("[code.exec] ── input ──\n{code}");

    // 1. Try microsandbox first
    let msb_result = if let Some(ws_id) = workspace {
        #[cfg(unix)]
        {
            tauri_plugin_sandbox::microvm::workspace_exec(ws_id, language, code)
                .await.map_err(|e| format!("workspace: {e}"))
        }
        #[cfg(not(unix))]
        { let _ = ws_id; Err::<Value, String>("workspaces require microsandbox (unix only)".into()) }
    } else {
        tauri_plugin_sandbox::microvm::run_in_microvm(language, code)
            .await.map_err(|e| format!("microsandbox: {e}"))
    };

    let val = match msb_result {
        Ok(v) => { log::info!("[code.exec] executed via microsandbox"); v }
        Err(msb_err) => {
            log::info!("[code.exec] microsandbox unavailable ({msb_err}), falling back to WASM");
            if language != "javascript" && language != "js" {
                return Err(format!(
                    "'{language}' requires microsandbox (msb server start --dev). \
                     WASM fallback only supports JavaScript. microsandbox error: {msb_err}"
                ));
            }
            let code = code.to_string();
            let mounts = mounts.to_vec();
            tokio::task::spawn_blocking(move || {
                tauri_plugin_sandbox::wasm_runtime::run_js_blocking(&code, &mounts)
            })
            .await.map_err(|e| format!("spawn_blocking: {e}"))?
            .map_err(|e| format!("WASM fallback failed: {e}"))?
        }
    };

    let exit_code = val["exit_code"].as_i64().unwrap_or(0);
    let stdout = val["stdout"].as_str().unwrap_or("").trim();
    let stderr = val["stderr"].as_str().unwrap_or("").trim();

    log::info!("[code.exec] exit_code={exit_code} stdout={} bytes", stdout.len());
    if !stderr.is_empty() { log::info!("[code.exec] stderr: {stderr}"); }

    let mut logs = Vec::new();
    if !stderr.is_empty() { for line in stderr.lines() { logs.push(line.to_string()); } }
    if let Some(url) = val["url"].as_str() { logs.push(format!("server detected: {url}")); }

    if exit_code != 0 {
        return Err(format!("code.exec failed (exit {}): {}", exit_code, stderr));
    }

    let output: Value = serde_json::from_str(stdout).unwrap_or_else(|_| {
        let mut out = serde_json::json!({ "result": stdout });
        if let Some(url) = val["url"].as_str() { out["url"] = Value::String(url.to_string()); }
        out
    });

    Ok(DispatchResult { output, wasm_logs: logs })
}

// ── JS tool dispatch ─────────────────────────────────────────────────────────

async fn dispatch_js_tool(source: &str, args: Value, mounts: &[PathBuf]) -> Result<DispatchResult, String> {
    let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "{}".into());
    let wrapped = format!(
        "var __args = {args_json};\n{source}\n\
         var __result = run(__args);\n\
         if (typeof __result === 'string') {{ console.log(__result); }}\n\
         else {{ console.log(JSON.stringify(__result)); }}"
    );

    let mounts = mounts.to_vec();
    let result = tokio::task::spawn_blocking(move || {
        tauri_plugin_sandbox::wasm_runtime::run_js_blocking(&wrapped, &mounts)
    })
    .await.map_err(|e| format!("spawn_blocking: {e}"))?;

    match result {
        Ok(val) => {
            let exit_code = val["exit_code"].as_i64().unwrap_or(0);
            let stdout = val["stdout"].as_str().unwrap_or("").trim();
            let stderr = val["stderr"].as_str().unwrap_or("").trim();
            let mut logs = Vec::new();
            if !stderr.is_empty() { for line in stderr.lines() { logs.push(line.to_string()); } }
            if exit_code != 0 { return Err(format!("JS tool failed (exit {}): {}", exit_code, stderr)); }
            let output: Value = serde_json::from_str(stdout)
                .unwrap_or_else(|_| serde_json::json!({ "result": stdout }));
            Ok(DispatchResult { output, wasm_logs: logs })
        }
        Err(e) => Err(format!("JS tool failed: {e}")),
    }
}

// ── JS tool scanning ─────────────────────────────────────────────────────────

fn scan_js_tools_dir(dir: &Path) -> Vec<JsTool> {
    let mut tools = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => { log::info!("[dispatcher] JS tools dir scan failed: {e}"); return tools; }
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("js") { continue; }
        let source = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) => { log::info!("[dispatcher] skipping '{}': {e}", path.display()); continue; }
        };
        if let Some((id, desc, schema)) = parse_js_tool_meta(&source, &path) {
            log::info!("[dispatcher] loaded JS tool '{id}' from {}", path.display());
            tools.push(JsTool {
                meta: ToolMeta { id: id.clone(), description: desc, parameters: schema },
                id, source,
            });
        }
    }
    tools
}

fn parse_js_tool_meta(source: &str, path: &Path) -> Option<(String, String, Value)> {
    let mut tool_id = None;
    let mut description = None;
    let mut schema_str = None;

    for line in source.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("//") { if !trimmed.is_empty() { break; } continue; }
        let comment = trimmed.trim_start_matches("//").trim();
        if let Some(val) = comment.strip_prefix("@tool ") { tool_id = Some(val.trim().to_string()); }
        else if let Some(val) = comment.strip_prefix("@description ") { description = Some(val.trim().to_string()); }
        else if let Some(val) = comment.strip_prefix("@schema ") { schema_str = Some(val.trim().to_string()); }
    }

    let id = tool_id.or_else(|| path.file_stem().map(|s| format!("custom.{}", s.to_string_lossy())))?;
    let desc = description.unwrap_or_else(|| format!("Custom JS tool: {id}"));
    let schema: Value = schema_str.and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}}));
    Some((id, desc, schema))
}

// ── Robot control tools ─────────────────────────────────────────────────────

fn move_tool_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "distance": {
                "type": "number",
                "description": "Distance in meters (default: 0.5)"
            }
        }
    })
}

fn robot_tool_metas() -> Vec<ToolMeta> {
    vec![
        ToolMeta {
            id:          "robot.move_forward".into(),
            description: "Move the robot forward (W key). Specify distance in meters.".into(),
            parameters:  move_tool_schema(),
        },
        ToolMeta {
            id:          "robot.move_backward".into(),
            description: "Move the robot backward (S key). Specify distance in meters.".into(),
            parameters:  move_tool_schema(),
        },
        ToolMeta {
            id:          "robot.move_left".into(),
            description: "Turn/strafe the robot left (A key). Specify distance in meters.".into(),
            parameters:  move_tool_schema(),
        },
        ToolMeta {
            id:          "robot.move_right".into(),
            description: "Turn/strafe the robot right (D key). Specify distance in meters.".into(),
            parameters:  move_tool_schema(),
        },
        ToolMeta {
            id:          "robot.stop".into(),
            description: "Emergency stop — immediately halt all robot motion.".into(),
            parameters:  serde_json::json!({"type": "object", "properties": {}}),
        },
        ToolMeta {
            id:          "robot.look".into(),
            description: "Describe what you currently see from the camera. No movement, just observation.".into(),
            parameters:  serde_json::json!({"type": "object", "properties": {}}),
        },
    ]
}

async fn dispatch_robot_http(
    tool_id: &str,
    args: Value,
    base_url: &str,
    client: &reqwest::Client,
) -> Result<DispatchResult, String> {
    let distance = args["distance"].as_f64().unwrap_or(0.5);

    let (direction, endpoint, dist) = match tool_id {
        "robot.move_forward"  => ("forward",  "move_forward",  distance),
        "robot.move_backward" => ("backward", "move_backward", distance),
        "robot.move_left"     => ("left",     "move_left",     distance),
        "robot.move_right"    => ("right",    "move_right",    distance),
        "robot.stop"          => ("stop",     "stop",          0.0),
        "robot.look"          => {
            let resp = client
                .get(&format!("{base_url}/look"))
                .send()
                .await
                .map_err(|e| format!("HTTP: {e}"))?;
            let text = resp.text().await.map_err(|e| format!("read: {e}"))?;
            let json: Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({"status": text}));
            return Ok(DispatchResult {
                output: json,
                wasm_logs: vec!["[robot] look".into()],
            });
        }
        _ => return Err(format!("unknown robot tool: {tool_id}")),
    };

    let url = format!("{base_url}/{endpoint}");
    let body = serde_json::json!({ "distance": dist });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read response: {e}"))?;

    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }

    let result_json: Value = serde_json::from_str(&text)
        .unwrap_or(serde_json::json!({"status": text}));

    Ok(DispatchResult {
        output: serde_json::json!({
            "action": direction,
            "distance": dist,
            "status": result_json
        }),
        wasm_logs: vec![format!("[robot] {direction} {dist:.2}m")],
    })
}

fn dispatch_robot_tool(
    tool_id: &str,
    args: Value,
    handler: &RobotCommandHandler,
) -> Result<DispatchResult, String> {
    let distance = args["distance"].as_f64().unwrap_or(0.5);

    let (direction, dist) = match tool_id {
        "robot.move_forward"  => ("forward",  distance),
        "robot.move_backward" => ("backward", distance),
        "robot.move_left"     => ("left",     distance),
        "robot.move_right"    => ("right",    distance),
        "robot.stop"          => ("stop",     0.0),
        "robot.look"          => {
            return Ok(DispatchResult {
                output: serde_json::json!({
                    "action": "look",
                    "status": "Observation requested. Check the camera feed in the next message."
                }),
                wasm_logs: vec![],
            });
        }
        _ => return Err(format!("unknown robot tool: {tool_id}")),
    };

    let result = handler(direction, dist)?;
    Ok(DispatchResult {
        output: serde_json::json!({
            "action": direction,
            "distance": dist,
            "status": result
        }),
        wasm_logs: vec![format!("[robot] {direction} {dist:.2}m")],
    })
}

// ── HTTP robot handler factory ──────────────────────────────────────────────

/// Create a [`RobotCommandHandler`] that forwards commands to a ProcTHOR-style HTTP server.
///
/// Maps directions to endpoints:
/// - `"forward"`  → `POST {base_url}/move_forward`
/// - `"backward"` → `POST {base_url}/move_backward`
/// - `"left"`     → `POST {base_url}/move_left`
/// - `"right"`    → `POST {base_url}/move_right`
/// - `"stop"`     → `POST {base_url}/stop`
///
/// The distance is sent as `{"distance": <value>}`.
pub fn http_robot_handler(base_url: String) -> RobotCommandHandler {
    let client = reqwest::Client::new();
    Box::new(move |direction: &str, distance: f64| {
        let endpoint = match direction {
            "forward"  => "move_forward",
            "backward" => "move_backward",
            "left"     => "move_left",
            "right"    => "move_right",
            "stop"     => "stop",
            other      => return Err(format!("unknown direction: {other}")),
        };

        let url = format!("{}/{endpoint}", base_url);
        let body = serde_json::json!({ "distance": distance });
        let client = client.clone();

        // We're inside a sync Fn called from an async context — spawn the
        // request on the existing runtime and wait via a oneshot channel so
        // we never call block_on (which panics inside tokio).
        let (tx, rx) = std::sync::mpsc::channel();
        tokio::spawn(async move {
            let result = async {
                let resp = client
                    .post(&url)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| format!("HTTP request failed: {e}"))?;

                let status = resp.status();
                let text = resp
                    .text()
                    .await
                    .map_err(|e| format!("read response: {e}"))?;

                if status.is_success() {
                    Ok(text)
                } else {
                    Err(format!("HTTP {status}: {text}"))
                }
            }
            .await;
            let _ = tx.send(result);
        });

        rx.recv().map_err(|e| format!("channel recv: {e}"))?
    })
}
