//! AppHandle-free MCP client for the CLI agent.
//!
//! The desktop activation stack (`core/mcp/helpers.rs`) is generic over a Tauri
//! `AppHandle` (data-folder lookup, `AppState`, event emit, bundled `bun`/`uv`
//! rewriting, health-monitor tasks). The CLI has no `AppHandle`, so this module
//! provides a focused connector: it reads the same `<jan_data>/mcp_config.json`,
//! reuses the shared `extract_command_args`/`extract_active_status` parsers, and
//! connects http/sse/stdio transports directly into a `SharedMcpServers` map that
//! the agent loop already consumes. No bundled-runtime rewriting, no Jan Browser
//! MCP bridge, no auto-reconnect monitor -- the CLI relies on the user's PATH.

use std::path::PathBuf;
use std::process::Stdio;

use rmcp::{
    model::{ClientCapabilities, ClientInfo, Implementation},
    transport::{
        sse_client::SseClientConfig, streamable_http_client::StreamableHttpClientTransportConfig,
        SseClientTransport, StreamableHttpClientTransport, TokioChildProcess,
    },
    ServiceExt,
};
use serde_json::Value;
use tokio::process::Command;

use crate::core::app::commands::resolve_jan_data_folder;
use crate::core::mcp::models::{extract_active_status, extract_command_args};
use crate::core::mcp::models::McpSettings;
use crate::core::state::{RunningServiceEnum, SharedMcpServers};

/// The Jan Browser MCP needs the desktop bridge/lockfile machinery, so it is
/// never offered or connected from the CLI.
const BROWSER_MCP_NAME: &str = "Jan Browser MCP";

/// A configured server as read from `mcp_config.json`.
pub struct McpServerEntry {
    pub name: String,
    pub active: bool,
    pub config: Value,
}

fn config_path() -> PathBuf {
    resolve_jan_data_folder().join("mcp_config.json")
}

fn read_config() -> Value {
    match std::fs::read_to_string(config_path()) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

/// Parsed `mcpSettings` block (tool-call timeout etc.), defaults when absent.
pub fn read_settings() -> McpSettings {
    read_config()
        .get("mcpSettings")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// All configured servers (excluding the desktop-only browser bridge), sorted by
/// name so the picker order is stable.
pub fn list_servers() -> Vec<McpServerEntry> {
    let cfg = read_config();
    let Some(servers) = cfg.get("mcpServers").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out: Vec<McpServerEntry> = servers
        .iter()
        .filter(|(name, _)| name.as_str() != BROWSER_MCP_NAME)
        .map(|(name, config)| McpServerEntry {
            name: name.clone(),
            active: extract_active_status(config).unwrap_or(false),
            config: config.clone(),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Persist a server's `active` flag back to `mcp_config.json` (pretty-printed,
/// atomic tmp+rename) so the choice survives across CLI sessions.
pub fn set_active(name: &str, active: bool) -> Result<(), String> {
    let path = config_path();
    let mut cfg = read_config();
    if !cfg.is_object() {
        cfg = serde_json::json!({});
    }
    let servers = cfg
        .as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    let entry = servers
        .as_object_mut()
        .ok_or("mcpServers is not an object")?
        .get_mut(name)
        .ok_or_else(|| format!("server '{name}' not found in mcp_config.json"))?;
    entry
        .as_object_mut()
        .ok_or_else(|| format!("config for '{name}' is not an object"))?
        .insert("active".to_string(), Value::Bool(active));

    let body = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Connect one server and insert it into the shared map. Best-effort: a bad
/// transport/config returns `Err` without touching the map.
pub async fn connect(
    name: &str,
    config: &Value,
    servers: &SharedMcpServers,
) -> Result<(), String> {
    if name == BROWSER_MCP_NAME {
        return Err("Jan Browser MCP is desktop-only".to_string());
    }
    let params = extract_command_args(config)
        .ok_or_else(|| format!("invalid MCP config for '{name}'"))?;

    let service = match (params.transport_type.as_deref(), params.url.as_deref()) {
        (Some("http"), Some(url)) => {
            let client = http_client(&params.headers)?;
            let transport = StreamableHttpClientTransport::with_client(
                client,
                StreamableHttpClientTransportConfig {
                    uri: url.to_string().into(),
                    ..Default::default()
                },
            );
            RunningServiceEnum::WithInit(
                client_info()
                    .serve(transport)
                    .await
                    .map_err(|e| format!("failed to connect to '{name}': {e}"))?,
            )
        }
        (Some("sse"), Some(url)) => {
            let client = http_client(&params.headers)?;
            let transport = SseClientTransport::start_with_client(
                client,
                SseClientConfig {
                    sse_endpoint: url.to_string().into(),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("failed to start SSE transport for '{name}': {e}"))?;
            RunningServiceEnum::WithInit(
                client_info()
                    .serve(transport)
                    .await
                    .map_err(|e| format!("failed to connect to '{name}': {e}"))?,
            )
        }
        _ => {
            let mut cmd = Command::new(&params.command);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            #[cfg(unix)]
            {
                cmd.process_group(0);
            }
            cmd.kill_on_drop(true);
            for arg in params.args.iter().filter_map(Value::as_str) {
                cmd.arg(arg);
            }
            for (k, v) in params.envs.iter() {
                if let Some(v) = v.as_str() {
                    cmd.env(k, v);
                }
            }
            let (process, _stderr) = TokioChildProcess::builder(cmd)
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("failed to spawn '{name}': {e}"))?;
            RunningServiceEnum::NoInit(
                ()
                    .serve(process)
                    .await
                    .map_err(|e| format!("failed to connect to '{name}': {e}"))?,
            )
        }
    };

    servers.lock().await.insert(name.to_string(), service);
    Ok(())
}

fn client_info() -> ClientInfo {
    ClientInfo {
        protocol_version: Default::default(),
        capabilities: ClientCapabilities::default(),
        client_info: Implementation {
            name: "Jan CLI Client".to_string(),
            version: "0.0.1".to_string(),
            title: None,
            website_url: None,
            icons: None,
        },
    }
}

/// Build a reqwest client that sends the configured `headers` on every request
/// (http/sse auth). Non-string header names/values are skipped.
fn http_client(
    headers: &serde_json::Map<String, Value>,
) -> Result<reqwest::Client, String> {
    let mut map = reqwest::header::HeaderMap::new();
    for (key, value) in headers.iter() {
        if let Some(v) = value.as_str() {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                map.insert(name, val);
            }
        }
    }
    reqwest::Client::builder()
        .default_headers(map)
        .build()
        .map_err(|e| e.to_string())
}

/// Remove a server from the shared map and cancel its transport.
pub async fn disconnect(name: &str, servers: &SharedMcpServers) {
    let service = servers.lock().await.remove(name);
    match service {
        Some(RunningServiceEnum::NoInit(s)) => {
            let _ = s.cancel().await;
        }
        Some(RunningServiceEnum::WithInit(s)) => {
            let _ = s.cancel().await;
        }
        None => {}
    }
}

/// Number of servers marked `active` in `mcp_config.json`.
pub fn active_count() -> usize {
    list_servers().iter().filter(|e| e.active).count()
}

/// Connect every `active` server into the shared map, best-effort. Returns the
/// names that connected successfully; failures are logged.
pub async fn connect_active(servers: &SharedMcpServers) -> Vec<String> {
    let mut connected = Vec::new();
    for entry in list_servers().into_iter().filter(|e| e.active) {
        match connect(&entry.name, &entry.config, servers).await {
            Ok(()) => connected.push(entry.name),
            Err(e) => log::warn!("MCP: {e}"),
        }
    }
    connected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_mcp_excluded_and_sorted() {
        // list_servers reads the real data folder; assert only invariants that
        // hold regardless of installed config.
        let servers = list_servers();
        assert!(servers.iter().all(|s| s.name != BROWSER_MCP_NAME));
        for w in servers.windows(2) {
            assert!(w[0].name <= w[1].name);
        }
    }
}
