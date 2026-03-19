//! WASM tool dispatcher — implements [`ToolDispatcher`] backed by the sandbox executor.
//!
//! Tool IDs derive from the file path relative to `tools_dir`:
//!   `tools_dir/web/search.wasm` → `web.search`
//!   `tools_dir/code/exec.wasm`  → `code.exec`

use serde_json::Value;
use std::path::PathBuf;

use crate::{DispatchResult, ToolDispatcher, ToolMeta};
use tauri_plugin_sandbox::executor;

struct WasmTool {
    id:   String,
    path: PathBuf,
    meta: ToolMeta,
}

pub struct Dispatcher {
    pub(crate) mounts: Vec<PathBuf>,
    wasm_tools:        Vec<WasmTool>,
}

impl Dispatcher {
    pub fn new() -> Self {
        Self { mounts: vec![], wasm_tools: vec![] }
    }

    pub fn with_tools_dir(tools_dir: PathBuf) -> Self {
        let wasm_tools = scan_tools_dir(&tools_dir);
        Self { mounts: vec![], wasm_tools }
    }

    pub fn with_mounts(mut self, mounts: Vec<PathBuf>) -> Self {
        self.mounts = mounts;
        self
    }
}

#[async_trait::async_trait]
impl ToolDispatcher for Dispatcher {
    fn tool_schemas(&self) -> Vec<ToolMeta> {
        self.wasm_tools.iter().map(|wt| wt.meta.clone()).collect()
    }

    async fn dispatch(&self, tool_id: &str, args: Value) -> Result<DispatchResult, String> {
        log::info!("[dispatcher] tool={tool_id}");

        let wt = match self.wasm_tools.iter().find(|w| w.id == tool_id) {
            Some(wt) => wt,
            None     => return Err(format!("unknown tool: '{tool_id}'")),
        };

        let path   = wt.path.clone();
        let mounts = self.mounts.clone();

        log::info!("[dispatcher] '{tool_id}' → WASM {}", path.display());

        let result = tokio::task::spawn_blocking(move || {
            executor::execute(&path, &args, mounts)
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))
        .and_then(|r| r.map_err(|e| e.to_string()));

        match result {
            Ok((output, logs)) => {
                log::debug!("[dispatcher] WASM '{tool_id}' ok ({} log lines)", logs.len());
                Ok(DispatchResult { output, wasm_logs: logs })
            }
            Err(e) => {
                log::warn!("[dispatcher] WASM '{tool_id}' failed: {e}");
                Err(format!("wasm execution failed: {e}"))
            }
        }
    }
}

fn scan_tools_dir(tools_dir: &std::path::Path) -> Vec<WasmTool> {
    let mut tools = Vec::new();

    let entries = match collect_wasm_files(tools_dir) {
        Ok(e)  => e,
        Err(e) => { log::warn!("[dispatcher] tools_dir scan failed: {e}"); return tools; }
    };

    for path in entries {
        let rel = match path.strip_prefix(tools_dir) {
            Ok(r)  => r,
            Err(_) => continue,
        };

        let id = rel
            .with_extension("")
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, ".");

        match executor::get_tool_info(&path) {
            Ok(info) => {
                log::info!("[dispatcher] loaded '{id}' from {}", path.display());
                tools.push(WasmTool {
                    meta: ToolMeta { id: id.clone(), description: info.description, parameters: info.schema },
                    id,
                    path,
                });
            }
            Err(e) => log::warn!("[dispatcher] skipping '{}': {e}", path.display()),
        }
    }

    tools
}

fn collect_wasm_files(dir: &std::path::Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut out = Vec::new();
    collect_wasm_recursive(dir, &mut out)?;
    Ok(out)
}

fn collect_wasm_recursive(dir: &std::path::Path, out: &mut Vec<PathBuf>) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            let _ = collect_wasm_recursive(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("wasm") {
            out.push(path);
        }
    }
    Ok(())
}
