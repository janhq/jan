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
use crate::core::mcp::models::McpSettings;
use crate::core::mcp::models::{extract_active_status, extract_command_args};
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

/// Resolve the config path under a data folder. `data_folder` is threaded
/// through the internal helpers so tests can point at a tempdir without a global
/// override; the public API uses the real Jan data folder via
/// `resolve_jan_data_folder()`.
fn config_path(data_folder: &std::path::Path) -> PathBuf {
    data_folder.join("mcp_config.json")
}

/// The real Jan data folder (the env override in `resolve_jan_data_folder`
/// applies, so a `JAN_DATA_FOLDER` redirect still works end to end).
fn default_data_folder() -> PathBuf {
    resolve_jan_data_folder()
}

fn read_config(data_folder: &std::path::Path) -> Value {
    match std::fs::read_to_string(config_path(data_folder)) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

/// Atomically persist a full `mcp_config.json` document (tmp + rename), the
/// same idiom `set_active` already uses. `mcpServers`/`mcpSettings` keys are
/// ensured so a caller passing a bare servers object still writes a valid doc.
fn write_config(data_folder: &std::path::Path, cfg: &Value) -> Result<(), String> {
    let path = config_path(data_folder);
    let mut doc = if cfg.is_object() {
        cfg.clone()
    } else {
        serde_json::json!({})
    };
    let obj = doc.as_object_mut().ok_or("mcp_config is not an object")?;
    obj.entry("mcpServers").or_insert_with(|| serde_json::json!({}));
    obj.entry("mcpSettings").or_insert_with(|| serde_json::json!({}));

    let body = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the `mcpServers` object as a mutable map, defaulting to an empty one.
fn servers_map_mut(cfg: &mut Value) -> &mut serde_json::Map<String, Value> {
    cfg.as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .expect("mcpServers is an object")
}

/// Parsed `mcpSettings` block (tool-call timeout etc.), defaults when absent.
pub fn read_settings() -> McpSettings {
    read_config(&default_data_folder())
        .get("mcpSettings")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// All configured servers (excluding the desktop-only browser bridge), sorted by
/// name so the picker order is stable.
pub fn list_servers() -> Vec<McpServerEntry> {
    list_servers_in(&default_data_folder())
}

/// `list_servers` against an explicit data folder (used by tests).
pub fn list_servers_in(data_folder: &std::path::Path) -> Vec<McpServerEntry> {
    let cfg = read_config(data_folder);
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
    set_active_in(&default_data_folder(), name, active)
}

fn set_active_in(data_folder: &std::path::Path, name: &str, active: bool) -> Result<(), String> {
    let mut cfg = read_config(data_folder);
    if !cfg.is_object() {
        cfg = serde_json::json!({});
    }
    let entry = servers_map_mut(&mut cfg)
        .get_mut(name)
        .ok_or_else(|| format!("server '{name}' not found in mcp_config.json"))?;
    entry
        .as_object_mut()
        .ok_or_else(|| format!("config for '{name}' is not an object"))?
        .insert("active".to_string(), Value::Bool(active));

    write_config(data_folder, &cfg)
}

/// Validate a server entry shape, reporting the missing field rather than the
/// generic "invalid MCP config" a connect would otherwise surface. Matches the
/// desktop's transport contract: `command`+`args` for stdio, or `type`+`url`
/// for http/sse.
pub fn validate_config(config: &Value) -> Result<(), String> {
    let obj = config
        .as_object()
        .ok_or_else(|| "server config must be a JSON object".to_string())?;
    let transport = obj
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("stdio");
    match transport {
        "http" | "sse" => {
            if obj.get("url").and_then(Value::as_str).is_none() {
                return Err(format!("server of type '{transport}' needs a 'url'"));
            }
        }
        "stdio" => {
            if obj.get("command").and_then(Value::as_str).is_none() {
                return Err("stdio server needs a 'command'".to_string());
            }
            if !obj.get("args").is_some_and(Value::is_array) {
                return Err("stdio server needs an 'args' array (may be empty)".to_string());
            }
        }
        other => {
            return Err(format!(
                "unknown transport '{other}' (expected stdio, http, or sse)"
            ));
        }
    }
    Ok(())
}

/// Validate a server name: non-empty and not the desktop-only browser bridge.
pub fn validate_server_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("server name cannot be empty".to_string());
    }
    if name == BROWSER_MCP_NAME {
        return Err(format!(
            "'{name}' is the desktop-only browser bridge and cannot be edited from the CLI"
        ));
    }
    Ok(())
}

/// Build a ready-to-persist server entry from typed fields, mirroring the
/// desktop's transport contract. `env`/`headers` are already parsed maps; the
/// callers (`jan cli mcp add` flags and the TUI form) both funnel through here
/// so neither re-implements the shape or its validation.
pub fn build_server_config(
    transport: &str,
    command: Option<&str>,
    args: Vec<String>,
    env: serde_json::Map<String, Value>,
    url: Option<&str>,
    headers: serde_json::Map<String, Value>,
    active: bool,
) -> Result<Value, String> {
    let mut config = serde_json::json!({ "type": transport, "active": active });
    match transport {
        "stdio" => {
            let command = command
                .ok_or_else(|| "stdio server needs a 'command' (e.g. npx, uvx)".to_string())?;
            config["command"] = Value::String(command.to_string());
            config["args"] = serde_json::json!(args);
            config["env"] = Value::Object(env);
        }
        "http" | "sse" => {
            let url = url.ok_or_else(|| format!("server of type '{transport}' needs a 'url'"))?;
            config["url"] = Value::String(url.to_string());
            if !headers.is_empty() {
                config["headers"] = Value::Object(headers);
            }
        }
        other => {
            return Err(format!(
                "unknown transport '{other}' (expected stdio, http, or sse)"
            ));
        }
    }
    validate_config(&config)?;
    Ok(config)
}

/// Add or replace a server entry (by name) in `mcp_config.json`, preserving any
/// existing `active` and other keys when the name is already present. Does not
/// touch the live connection -- the caller decides whether to connect.
pub fn upsert_server(name: &str, config: &Value) -> Result<(), String> {
    upsert_server_in(&default_data_folder(), name, config)
}

fn upsert_server_in(
    data_folder: &std::path::Path,
    name: &str,
    config: &Value,
) -> Result<(), String> {
    validate_server_name(name)?;
    validate_config(config)?;
    let mut cfg = read_config(data_folder);
    if !cfg.is_object() {
        cfg = serde_json::json!({});
    }
    let servers = servers_map_mut(&mut cfg);
    let existing_active = servers.get(name).and_then(|c| c.get("active")).cloned();
    let mut entry = config.clone();
    // Preserve the previous active flag on edit unless the new config sets one,
    // so editing a server never silently disables it.
    if entry.get("active").is_none() {
        if let Some(active) = existing_active {
            entry["active"] = active;
        }
    }
    servers.insert(name.to_string(), entry);
    write_config(data_folder, &cfg)
}

/// Remove a server entry by name from `mcp_config.json`. Errors if absent. Does
/// not disconnect a live transport -- the caller decides.
pub fn remove_server(name: &str) -> Result<(), String> {
    remove_server_in(&default_data_folder(), name)
}

fn remove_server_in(data_folder: &std::path::Path, name: &str) -> Result<(), String> {
    validate_server_name(name)?;
    let mut cfg = read_config(data_folder);
    if !cfg.is_object() {
        cfg = serde_json::json!({});
    }
    let removed = servers_map_mut(&mut cfg).remove(name).is_some();
    if !removed {
        return Err(format!("server '{name}' not found in mcp_config.json"));
    }
    write_config(data_folder, &cfg)
}

/// Read one server entry by name (excluding the browser bridge), `None` when
/// absent. Used by the edit path to prefill a form.
pub fn get_server(name: &str) -> Option<McpServerEntry> {
    get_server_in(&default_data_folder(), name)
}

fn get_server_in(data_folder: &std::path::Path, name: &str) -> Option<McpServerEntry> {
    let cfg = read_config(data_folder);
    let servers = cfg.get("mcpServers")?.as_object()?;
    let config = servers.get(name)?;
    if name == BROWSER_MCP_NAME {
        return None;
    }
    Some(McpServerEntry {
        name: name.to_string(),
        active: extract_active_status(config).unwrap_or(false),
        config: config.clone(),
    })
}

/// Split a `KEY=VALUE` pair, rejecting anything without a separator or an empty
/// key. Shared by the headless `jan cli mcp add` flags and the TUI add/edit form
/// so the two surfaces parse `--env`/`--header` identically.
pub fn split_kv(kv: &str, what: &str) -> Result<(String, String), String> {
    match kv.split_once('=') {
        Some((k, v)) if !k.trim().is_empty() => Ok((k.trim().to_string(), v.to_string())),
        _ => Err(format!("--{what} must be KEY=VALUE, got '{kv}'")),
    }
}

/// Parse a whitespace-separated argument string into a list, trimming empty
/// runs. No shell quoting: the TUI form takes plain, already-split arguments.
pub fn parse_args(s: &str) -> Vec<String> {
    s.split_whitespace().map(str::to_string).collect()
}

/// Parse comma-separated `KEY=VALUE` pairs into a JSON object map. Empty input
/// yields an empty map; a malformed pair surfaces the first error.
pub fn parse_pairs(s: &str, what: &str) -> Result<serde_json::Map<String, Value>, String> {
    let mut map = serde_json::Map::new();
    for part in s.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let (k, v) = split_kv(part, what)?;
        map.insert(k, Value::String(v));
    }
    Ok(map)
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

/// Outcome of a best-effort connect of every `active` server.
///
/// Failures are returned rather than logged: the TUI owns the terminal while
/// this runs, so a `log::warn!` here paints raw text over the alternate screen.
/// The caller decides how to surface them (the TUI notes them in the
/// transcript alongside the ready line; headless logs them as before).
#[derive(Debug, Default)]
pub struct ConnectOutcome {
    /// Servers that came up, in the order they connected.
    pub connected: Vec<String>,
    /// One `failed to connect to '<name>': <error>` per server that didn't.
    pub failed: Vec<String>,
}

/// Connect every `active` server into the shared map, best-effort.
pub async fn connect_active(servers: &SharedMcpServers) -> ConnectOutcome {
    let mut out = ConnectOutcome::default();
    for entry in list_servers().into_iter().filter(|e| e.active) {
        match connect(&entry.name, &entry.config, servers).await {
            Ok(()) => out.connected.push(entry.name),
            Err(e) => out.failed.push(e),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A temporary data folder with a fresh config path, cleaned up on drop.
    fn temp_data() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[test]
    fn upsert_creates_and_preserves_active_on_edit() {
        let data = temp_data();
        let folder = data.path();
        let cfg = serde_json::json!({
            "command": "npx",
            "args": ["-y", "server"],
        });
        upsert_server_in(folder, "files", &cfg).unwrap();

        let entry = get_server_in(folder, "files").unwrap();
        assert_eq!(entry.name, "files");
        assert!(!entry.active);

        // Mark active, then edit again: active must survive.
        set_active_in(folder, "files", true).unwrap();
        upsert_server_in(
            folder,
            "files",
            &serde_json::json!({
                "command": "npx",
                "args": ["-y", "server2"],
            }),
        )
        .unwrap();
        let entry = get_server_in(folder, "files").unwrap();
        assert!(entry.active, "editing must not clear the active flag");
        assert_eq!(entry.config["args"][1], "server2");
    }

    #[test]
    fn upsert_rejects_bad_shape_and_browser_name() {
        let data = temp_data();
        let folder = data.path();
        // Missing command.
        assert!(upsert_server_in(folder, "x", &serde_json::json!({ "args": [] })).is_err());
        // Missing args.
        assert!(
            upsert_server_in(folder, "x", &serde_json::json!({ "command": "npx" })).is_err()
        );
        // Unknown transport.
        assert!(
            upsert_server_in(
                folder,
                "x",
                &serde_json::json!({ "type": "bogus", "url": "http://x" })
            )
            .is_err()
        );
        // Desktop-only browser bridge.
        assert!(
            upsert_server_in(
                folder,
                BROWSER_MCP_NAME,
                &serde_json::json!({ "command": "npx", "args": [] })
            )
            .is_err()
        );
    }

    #[test]
    fn http_and_sse_validate_by_url() {
        let data = temp_data();
        let folder = data.path();
        let http = serde_json::json!({ "type": "http", "url": "https://x/mcp" });
        assert!(validate_config(&http).is_ok());
        upsert_server_in(folder, "http", &http).unwrap();

        let sse_no_url = serde_json::json!({ "type": "sse" });
        let err = validate_config(&sse_no_url).unwrap_err();
        assert!(err.contains("url"), "{err}");
        assert!(upsert_server_in(folder, "sse", &sse_no_url).is_err());
    }

    #[test]
    fn remove_deletes_and_errors_when_absent() {
        let data = temp_data();
        let folder = data.path();
        upsert_server_in(
            folder,
            "files",
            &serde_json::json!({ "command": "npx", "args": [] }),
        )
        .unwrap();
        remove_server_in(folder, "files").unwrap();
        assert!(get_server_in(folder, "files").is_none());

        let err = remove_server_in(folder, "files").unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }

    #[test]
    fn write_config_ensures_top_level_keys() {
        let data = temp_data();
        let folder = data.path();
        // A caller passing a bare servers object still gets a valid doc.
        write_config(folder, &serde_json::json!({ "mcpServers": {} })).unwrap();
        let raw = std::fs::read_to_string(config_path(folder)).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(doc.get("mcpServers").is_some());
        assert!(doc.get("mcpSettings").is_some());
    }

    #[test]
    fn list_filters_browser_and_orders_by_name() {
        let data = temp_data();
        let folder = data.path();
        upsert_server_in(
            folder,
            "zeta",
            &serde_json::json!({ "command": "npx", "args": [] }),
        )
        .unwrap();
        upsert_server_in(
            folder,
            "alpha",
            &serde_json::json!({ "command": "npx", "args": [] }),
        )
        .unwrap();
        write_config(
            folder,
            &serde_json::json!({
                "mcpServers": {
                    "zeta": { "command": "npx", "args": [] },
                    "alpha": { "command": "npx", "args": [] },
                }
            }),
        )
        .and_then(|_| {
            // Seed the browser bridge directly (upsert refuses it).
            let mut cfg = read_config(folder);
            servers_map_mut(&mut cfg).insert(
                BROWSER_MCP_NAME.to_string(),
                serde_json::json!({ "command": "npx", "args": [] }),
            );
            write_config(folder, &cfg)
        })
        .unwrap();

        let names: Vec<String> = list_servers_in(folder)
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["alpha", "zeta"]);
    }

    #[test]
    fn split_kv_and_parse_pairs() {
        assert_eq!(
            split_kv("K=V", "env").unwrap(),
            ("K".to_string(), "V".to_string())
        );
        assert!(split_kv("novalue", "env").is_err());
        assert!(split_kv("=V", "header").is_err());

        let map = parse_pairs("A=1,B=2", "env").unwrap();
        assert_eq!(map.get("A").and_then(Value::as_str), Some("1"));
        assert_eq!(map.get("B").and_then(Value::as_str), Some("2"));
        assert!(parse_pairs("A=1,broken", "env").is_err());
        assert!(parse_pairs("", "env").unwrap().is_empty());
        assert_eq!(parse_args("npx  -y  my-mcp"), vec!["npx", "-y", "my-mcp"]);
    }

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
