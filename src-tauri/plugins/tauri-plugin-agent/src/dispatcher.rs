//! Tool dispatcher — routes tool calls to JS tools and builtins.
//!
//! ## JS tools (user-created, runtime-extensible)
//! Plain `.js` files in `user_tools_dir` (default: `~/.jan/tools/`).
//! Metadata parsed from `// @tool`, `// @description`, `// @schema` comments.
//! Executed inside js-runner.wasm (Boa) via subprocess with `httpGet`, `readFile`, etc.
//!
//! ## Builtins
//! - `code.exec` — run arbitrary JS in a subprocess WASM sandbox (one-off execution)
//! - `fs.write` — write a file to disk (used by agent to create new tools)
//!
//! When the agent writes a `.js` file to the user tools dir, it is automatically
//! hot-loaded and becomes callable in the same session.

use serde_json::Value;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::{DispatchResult, ToolDispatcher, ToolMeta};

struct JsTool {
    id:          String,
    source_path: PathBuf,
    source:      String,
    meta:        ToolMeta,
}

pub struct Dispatcher {
    pub(crate) mounts:     Vec<PathBuf>,
    js_tools:              RwLock<Vec<JsTool>>,
    user_tools_dir:        Option<PathBuf>,
}

impl Dispatcher {
    pub fn new() -> Self {
        Self { mounts: vec![], js_tools: RwLock::new(vec![]), user_tools_dir: None }
    }

    pub fn with_tools_dir(_tools_dir: PathBuf) -> Self {
        // WASM tools removed — all execution goes through code.exec (subprocess).
        // tools_dir is accepted for API compatibility but ignored.
        Self::new()
    }

    pub fn with_mounts(mut self, mounts: Vec<PathBuf>) -> Self {
        self.mounts = mounts;
        self
    }

    /// Scan a directory for user-created `.js` tool files and register them.
    pub fn with_user_tools_dir(mut self, dir: PathBuf) -> Self {
        if dir.is_dir() {
            let tools = scan_js_tools_dir(&dir);
            log::info!("[dispatcher] loaded {} JS tools from {}", tools.len(), dir.display());
            self.js_tools = RwLock::new(tools);
        }
        self.user_tools_dir = Some(dir);
        self
    }
}

/// Schema for the built-in `fs.write` tool.
fn fs_write_meta() -> ToolMeta {
    ToolMeta {
        id:          "fs.write".into(),
        description: "Write content to a file on disk. Use this to create reusable JS tools in ~/.jan/tools/. \
                      The file is written atomically and available immediately."
            .into(),
        parameters:  serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute file path to write (e.g. ~/.jan/tools/my_tool.js)"
                },
                "content": {
                    "type": "string",
                    "description": "The file content to write"
                }
            },
            "required": ["path", "content"]
        }),
    }
}

/// Schema for the built-in `code.exec` tool.
fn code_exec_meta() -> ToolMeta {
    ToolMeta {
        id:          "code.exec".into(),
        description: "Execute JavaScript code in a sandboxed WASM runtime. \
                      Globals: httpGet(url), JSON.parse/stringify, readFile(path), writeFile(path,content), \
                      formatDate(ms?), console.log(). Do NOT use fetch(), require(), import, or async/await. \
                      Print results with console.log()."
            .into(),
        parameters:  serde_json::json!({
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "JavaScript code to execute"
                }
            },
            "required": ["code"]
        }),
    }
}

#[async_trait::async_trait]
impl ToolDispatcher for Dispatcher {
    fn tool_schemas(&self) -> Vec<ToolMeta> {
        let mut schemas: Vec<ToolMeta> = Vec::new();
        if let Ok(js) = self.js_tools.read() {
            schemas.extend(js.iter().map(|jt| jt.meta.clone()));
        }
        schemas.push(code_exec_meta());
        schemas.push(fs_write_meta());
        schemas
    }

    async fn dispatch(&self, tool_id: &str, args: Value) -> Result<DispatchResult, String> {
        log::info!("[dispatcher] tool={tool_id}");

        // Built-in: code.exec
        if tool_id == "code.exec" {
            return self.handle_code_exec(args).await;
        }

        // Built-in: fs.write
        if tool_id == "fs.write" {
            return self.handle_fs_write(args).await;
        }

        // Try JS tools — clone data out of the lock to avoid holding it across await
        let js_match = {
            let js = self.js_tools.read().map_err(|e| format!("lock: {e}"))?;
            js.iter().find(|j| j.id == tool_id).map(|jt| {
                (jt.source_path.clone(), jt.source.clone())
            })
        };
        if let Some((source_path, source)) = js_match {
            log::info!("[dispatcher] '{tool_id}' → JS {}", source_path.display());
            let jt = JsTool {
                id: tool_id.to_string(),
                source_path,
                source,
                meta: ToolMeta { id: tool_id.to_string(), description: String::new(), parameters: serde_json::json!({}) },
            };
            return dispatch_js_tool(&jt, args, &self.mounts).await;
        }

        Err(format!("unknown tool: '{tool_id}'"))
    }
}

// ── Built-in: code.exec ──────────────────────────────────────────────────────

impl Dispatcher {
    async fn handle_code_exec(&self, args: Value) -> Result<DispatchResult, String> {
        let code = args["code"].as_str().ok_or("code.exec: missing 'code'")?;

        log::info!("[code.exec] ── input ──\n{code}");

        let code = code.to_string();
        let mounts = self.mounts.clone();
        let result = tokio::task::spawn_blocking(move || {
            tauri_plugin_sandbox::wasm_runtime::run_js_blocking(&code, &mounts)
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?;

        match result {
            Ok(val) => {
                let exit_code = val["exit_code"].as_i64().unwrap_or(0);
                let stdout = val["stdout"].as_str().unwrap_or("").trim();
                let stderr = val["stderr"].as_str().unwrap_or("").trim();

                log::info!("[code.exec] ── stdout ──\n{stdout}");
                if !stderr.is_empty() {
                    log::info!("[code.exec] ── stderr ──\n{stderr}");
                }
                log::info!("[code.exec] exit_code={exit_code}");

                let mut logs = Vec::new();
                if !stderr.is_empty() {
                    for line in stderr.lines() {
                        logs.push(line.to_string());
                    }
                }

                if exit_code != 0 {
                    return Err(format!("code.exec failed (exit {}): {}", exit_code, stderr));
                }

                let output: Value = serde_json::from_str(stdout)
                    .unwrap_or_else(|_| serde_json::json!({ "result": stdout }));

                Ok(DispatchResult { output, wasm_logs: logs })
            }
            Err(e) => Err(format!("code.exec failed: {e}")),
        }
    }
}

// ── Built-in: fs.write ───────────────────────────────────────────────────────

impl Dispatcher {
    async fn handle_fs_write(&self, args: Value) -> Result<DispatchResult, String> {
        let raw_path = args["path"].as_str().ok_or("fs.write: missing 'path'")?;
        let content = args["content"].as_str().ok_or("fs.write: missing 'content'")?;

        // Expand ~ to home dir
        let path = if raw_path.starts_with("~/") {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| "~".into());
            PathBuf::from(home).join(&raw_path[2..])
        } else {
            PathBuf::from(raw_path)
        };

        // Create parent dirs if needed
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("fs.write: mkdir {}: {e}", parent.display()))?;
        }

        std::fs::write(&path, content)
            .map_err(|e| format!("fs.write: {}: {e}", path.display()))?;

        log::info!("[dispatcher] fs.write → {} ({} bytes)", path.display(), content.len());

        // Hot-load: if the file is a .js in the user tools dir, register it immediately
        if path.extension().and_then(|e| e.to_str()) == Some("js") {
            if let Some(ref tools_dir) = self.user_tools_dir {
                if path.starts_with(tools_dir) {
                    if let Some((id, description, schema)) = parse_js_tool_meta(content, &path) {
                        let new_tool = JsTool {
                            meta: ToolMeta { id: id.clone(), description, parameters: schema },
                            id: id.clone(),
                            source_path: path.clone(),
                            source: content.to_string(),
                        };
                        if let Ok(mut js) = self.js_tools.write() {
                            // Replace existing tool with same id, or add new
                            if let Some(existing) = js.iter_mut().find(|t| t.id == id) {
                                *existing = new_tool;
                                log::info!("[dispatcher] hot-reloaded JS tool '{id}'");
                            } else {
                                log::info!("[dispatcher] hot-loaded new JS tool '{id}'");
                                js.push(new_tool);
                            }
                        }
                    }
                }
            }
        }

        Ok(DispatchResult {
            output: serde_json::json!({
                "ok": true,
                "path": path.display().to_string(),
                "bytes": content.len(),
            }),
            wasm_logs: vec![],
        })
    }
}

// ── JS tool dispatch ──────────────────────────────────────────────────────────

async fn dispatch_js_tool(
    tool: &JsTool,
    args: Value,
    mounts: &[PathBuf],
) -> Result<DispatchResult, String> {
    let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "{}".into());

    // Wrap the tool source: inject args, call run(), print result as JSON
    let wrapped = format!(
        r#"var __args = {};
{}
var __result = run(__args);
if (typeof __result === 'string') {{
    console.log(__result);
}} else {{
    console.log(JSON.stringify(__result));
}}"#,
        args_json, tool.source
    );

    let mounts = mounts.to_vec();
    let result = tokio::task::spawn_blocking(move || {
        tauri_plugin_sandbox::wasm_runtime::run_js_blocking(&wrapped, &mounts)
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?;

    match result {
        Ok(val) => {
            let exit_code = val["exit_code"].as_i64().unwrap_or(0);
            let stdout = val["stdout"].as_str().unwrap_or("").trim();
            let stderr = val["stderr"].as_str().unwrap_or("").trim();

            let mut logs = Vec::new();
            if !stderr.is_empty() {
                for line in stderr.lines() {
                    logs.push(line.to_string());
                }
            }

            if exit_code != 0 {
                return Err(format!("JS tool failed (exit {}): {}", exit_code, stderr));
            }

            // Parse stdout as JSON output
            let output: Value = serde_json::from_str(stdout)
                .unwrap_or_else(|_| serde_json::json!({ "result": stdout }));

            Ok(DispatchResult { output, wasm_logs: logs })
        }
        Err(e) => Err(format!("JS tool execution failed: {e}")),
    }
}

// ── JS tool scanning ─────────────────────────────────────────────────────────

/// Scan a directory for `.js` files with tool metadata comments.
///
/// Expected format:
/// ```js
/// // @tool my.tool_name
/// // @description What this tool does
/// // @schema {"type":"object","properties":{...}}
///
/// function run(args) {
///   // ...
///   return { result: "..." };
/// }
/// ```
fn scan_js_tools_dir(dir: &std::path::Path) -> Vec<JsTool> {
    let mut tools = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(e)  => e,
        Err(e) => { log::warn!("[dispatcher] JS tools dir scan failed: {e}"); return tools; }
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("js") {
            continue;
        }

        let source = match std::fs::read_to_string(&path) {
            Ok(s)  => s,
            Err(e) => { log::warn!("[dispatcher] skipping '{}': {e}", path.display()); continue; }
        };

        match parse_js_tool_meta(&source, &path) {
            Some((id, description, schema)) => {
                log::info!("[dispatcher] loaded JS tool '{id}' from {}", path.display());
                tools.push(JsTool {
                    meta: ToolMeta {
                        id: id.clone(),
                        description,
                        parameters: schema,
                    },
                    id,
                    source_path: path,
                    source,
                });
            }
            None => {
                log::warn!(
                    "[dispatcher] skipping '{}': missing @tool or @description metadata",
                    path.display()
                );
            }
        }
    }

    tools
}

/// Parse `// @tool`, `// @description`, `// @schema` from the top of a JS file.
fn parse_js_tool_meta(
    source: &str,
    path: &std::path::Path,
) -> Option<(String, String, Value)> {
    let mut tool_id = None;
    let mut description = None;
    let mut schema_str = None;

    for line in source.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("//") {
            // Stop parsing comments at first non-comment line
            if !trimmed.is_empty() {
                break;
            }
            continue;
        }

        let comment = trimmed.trim_start_matches("//").trim();
        if let Some(val) = comment.strip_prefix("@tool ") {
            tool_id = Some(val.trim().to_string());
        } else if let Some(val) = comment.strip_prefix("@description ") {
            description = Some(val.trim().to_string());
        } else if let Some(val) = comment.strip_prefix("@schema ") {
            schema_str = Some(val.trim().to_string());
        }
    }

    let id = tool_id.or_else(|| {
        // Derive ID from filename: hackernews.js → custom.hackernews
        path.file_stem()
            .map(|s| format!("custom.{}", s.to_string_lossy()))
    })?;

    let desc = description.unwrap_or_else(|| format!("Custom JS tool: {id}"));

    let mut schema: Value = schema_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({
            "type": "object",
            "properties": {},
        }));

    // Sanitize: ensure property values are objects, not strings
    if let Some(props) = schema.get_mut("properties").and_then(|p| p.as_object_mut()) {
        let keys: Vec<String> = props.keys().cloned().collect();
        for key in keys {
            if let Some(val) = props.get_mut(&key) {
                if let Some(s) = val.as_str() {
                    if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                        *val = parsed;
                    } else {
                        *val = serde_json::json!({"type": "string"});
                    }
                }
            }
        }
    }

    // Ensure "required" is at the top level, not inside "properties"
    if let Some(props) = schema.get_mut("properties").and_then(|p| p.as_object_mut()) {
        if let Some(req) = props.remove("required") {
            schema.as_object_mut().unwrap().insert("required".to_string(), req);
        }
    }

    Some((id, desc, schema))
}
