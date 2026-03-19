pub mod agent;
pub mod commands;
pub mod dispatcher;
pub mod executor;
pub mod manifest;
pub mod microvm;
pub mod utils;
pub mod wasm_runtime;

pub use agent::{AgentConfig, AgentEvent, AgentLoop, AgentResponse, ChatMessage, FinishReason};
pub use manifest::{Manifest, RiskLevel, ToolDef};
pub use dispatcher::Dispatcher;

use serde_json::Value;
use std::sync::Arc;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};
use tokio::sync::Mutex;

// ── Tool dispatcher trait ─────────────────────────────────────────────────────

/// The result of executing one tool call.
#[derive(Debug)]
pub struct DispatchResult {
    pub output:    Value,
    /// Log lines emitted by the tool (e.g. WASM `host::log` calls).
    pub wasm_logs: Vec<String>,
}

/// Schema + description for one tool — used to build the LLM's tools array.
#[derive(Debug, Clone)]
pub struct ToolMeta {
    pub id:          String,
    pub description: String,
    /// JSON Schema object for the tool's parameters.
    pub parameters:  Value,
}

/// Async, object-safe interface for dispatching tool calls.
///
/// `AgentLoop` holds a `Box<dyn ToolDispatcher>`, so any type that implements
/// this trait can be plugged in without touching the loop itself.
#[async_trait::async_trait]
pub trait ToolDispatcher: Send + Sync {
    /// Execute the named tool with the given arguments.
    async fn dispatch(&self, tool_id: &str, args: Value) -> Result<DispatchResult, String>;

    /// Return the schema for every tool this dispatcher knows about.
    /// Called once per agent run to build the LLM's `tools` array.
    fn tool_schemas(&self) -> Vec<ToolMeta>;
}

// ── Plugin state + init ───────────────────────────────────────────────────────

pub struct AgentState {
    pub agent:    Arc<AgentLoop>,
    pub history:  Arc<Mutex<Vec<ChatMessage>>>,
    pub manifest: Arc<Manifest>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("agent")
        .invoke_handler(tauri::generate_handler![
            commands::agent_run,
            commands::agent_reset,
            commands::get_tool_manifest,
        ])
        .setup(|app, _api| {
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let tools_dir = resource_dir.join("tools");
            let manifest  = Arc::new(Manifest::load(&tools_dir));

            log::info!(
                "[agent] loaded manifest v{} with {} tools",
                manifest.version,
                manifest.tools.len()
            );

            let base_url = std::env::var("AGENT_API_URL")
                .unwrap_or_else(|_| "http://localhost:1337".to_string());
            let model_id = std::env::var("AGENT_MODEL")
                .unwrap_or_else(|_| "default".to_string());
            let api_key  = std::env::var("AGENT_API_KEY").ok()
                .filter(|k| !k.is_empty());

            let dispatcher = Dispatcher::with_tools_dir(tools_dir);
            let agent      = Arc::new(AgentLoop::new_with_key(
                base_url,
                model_id,
                api_key,
                dispatcher,
            ));

            let state = Arc::new(AgentState {
                agent,
                history:  Arc::new(Mutex::new(vec![])),
                manifest,
            });
            app.manage(state);
            Ok(())
        })
        .build()
}
