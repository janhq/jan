use rmcp::model::{CallToolRequestParams, CallToolResult};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::{
    constants::DEFAULT_MCP_CONFIG,
    helpers::{restart_active_mcp_servers, start_mcp_server, terminate_browser_mcp},
    truncate::truncate_tool_result,
};
use crate::core::{
    app::commands::get_jan_data_folder_path,
    mcp::models::{McpSettings, ServerSummary},
    mcp::oauth,
    state::AppState,
};
use crate::core::{
    mcp::models::ToolWithServer,
    state::{RunningMcpService, SharedMcpServers},
};
use rmcp::{service::Peer, RoleClient};
use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::Arc,
    time::Duration,
};

type McpPeer = Peer<RoleClient>;

// RunningService owns the task and is not Clone. Clone its Arc-backed Peer,
// never the owner: removal/cancel still closes the original connection.
async fn snapshot_servers(servers: &SharedMcpServers) -> HashMap<String, McpPeer> {
    snapshot_handles(servers, |service| service.peer().clone()).await
}

async fn snapshot_handles<T, H>(
    servers: &tokio::sync::Mutex<HashMap<String, T>>,
    clone_handle: impl Fn(&T) -> H,
) -> HashMap<String, H> {
    let guard = servers.lock().await;
    guard
        .iter()
        .map(|(name, service)| (name.clone(), clone_handle(service)))
        .collect()
}

fn same_connection(service: &RunningMcpService, peer: &McpPeer) -> bool {
    !service.is_closed()
        && !peer.is_transport_closed()
        && match (service.peer_info(), peer.peer_info()) {
            (Some(current), Some(snapshot)) => Arc::ptr_eq(&current, &snapshot),
            _ => false,
        }
}

// Bypass rmcp list_tools response caching, including server TTL/stale fallback.
// Explicit validation and legacy routing need live schemas, not cached responses.
async fn list_live_tools(peer: &McpPeer) -> Result<Vec<rmcp::model::Tool>, rmcp::ServiceError> {
    use rmcp::model::{ClientRequest, ListToolsRequest, PaginatedRequestParams, ServerResult};
    let mut tools = Vec::new();
    let mut cursor = None;
    loop {
        let response = peer
            .send_request(ClientRequest::ListToolsRequest(ListToolsRequest {
                method: Default::default(),
                params: Some({
                    let mut params = PaginatedRequestParams::default();
                    params.cursor = cursor;
                    params
                }),
                extensions: Default::default(),
            }))
            .await?;
        let ServerResult::ListToolsResult(page) = response else {
            return Err(rmcp::ServiceError::UnexpectedResponse);
        };
        tools.extend(page.tools);
        cursor = page.next_cursor;
        if cursor.is_none() {
            return Ok(tools);
        }
    }
}

async fn tool_call_timeout(state: &AppState) -> Duration {
    state.mcp_settings.lock().await.tool_call_timeout_duration()
}

/// Shared implementation for listing MCP tools.
///
/// - `server_filter: None` — every enabled server (same behavior as `get_tools`).
/// - `server_filter: Some(names)` — only enabled servers in that set; unknown names
///   are skipped (logged).
///
/// A server counts as "enabled" if it's in `mcp_active_servers`, regardless of
/// whether it's currently connected — a transiently disconnected server still
/// contributes its last successfully listed tools (`mcp_last_known_tools`), so
/// the tool schema Jan sends stays present and stable across reconnects instead
/// of shrinking/growing and invalidating the downstream KV-cache prefix.
/// `mcp_last_known_tools` is only cleared by explicit user deactivation
/// (`deactivate_mcp_server`), never by a transient list-tools failure here.
async fn collect_mcp_tools<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    server_filter: Option<HashSet<String>>,
    fresh_only: bool,
) -> Result<Vec<ToolWithServer>, String> {
    let timeout_duration = tool_call_timeout(state).await;
    let mut all_tools: Vec<ToolWithServer> = Vec::new();
    let mut removed_any = false;

    let server_names: Vec<String> = {
        let active_servers = state.mcp_active_servers.lock().await;
        match &server_filter {
            None => active_servers.keys().cloned().collect(),
            Some(filter) => {
                for name in filter {
                    if !active_servers.contains_key(name) {
                        log::debug!(
                            "collect_mcp_tools: requested server {name:?} is not enabled; skipping"
                        );
                    }
                }
                filter
                    .iter()
                    .filter(|n| active_servers.contains_key(*n))
                    .cloned()
                    .collect()
            }
        }
    };

    // Fresh authorization inventories are snapshots, not advertisement caches.
    let initial_connections = if fresh_only {
        Some(snapshot_servers(&state.mcp_servers).await)
    } else {
        None
    };
    let initial_names: HashSet<String> = server_names.iter().cloned().collect();

    for server_name in server_names {
        let peer = {
            let servers = state.mcp_servers.lock().await;
            servers
                .get(&server_name)
                .map(|service| service.peer().clone())
        };
        if fresh_only && peer.is_none() {
            return Err(format!(
                "MCP server '{server_name}' disconnected during fresh discovery"
            ));
        }
        let maybe_list_result = match &peer {
            Some(peer) => Some(timeout(timeout_duration, list_live_tools(peer)).await),
            None => None,
        };

        if fresh_only && !matches!(&maybe_list_result, Some(Ok(Ok(_)))) {
            return Err(format!(
                "Fresh MCP discovery failed for server '{server_name}'"
            ));
        }
        let fresh_tools = match maybe_list_result {
            Some(Ok(Ok(tools))) => {
                let mapped: Vec<ToolWithServer> = tools
                    .into_iter()
                    .map(|tool| ToolWithServer {
                        name: tool.name.to_string(),
                        description: tool.description.as_ref().map(|d| d.to_string()),
                        input_schema: serde_json::Value::Object((*tool.input_schema).clone()),
                        server: server_name.clone(),
                    })
                    .collect();
                // Publish atomically with connection/deactivation checks. This
                // follows lifecycle lock order servers -> active -> cache; only
                // local state awaits here, never remote work.
                let servers = state.mcp_servers.lock().await;
                let connected = servers
                    .get(&server_name)
                    .is_some_and(|service| same_connection(service, peer.as_ref().unwrap()));
                let active = state.mcp_active_servers.lock().await;
                if !active.contains_key(&server_name) {
                    if fresh_only {
                        return Err("MCP inventory changed during discovery; retry".into());
                    }
                    continue;
                }
                if !connected {
                    if fresh_only {
                        return Err("MCP inventory changed during discovery; retry".into());
                    }
                    // Ignore the stale response but preserve the enabled server's
                    // advertisement across reconnects, just as on list failure.
                    None
                } else {
                    state
                        .mcp_last_known_tools
                        .lock()
                        .await
                        .insert(server_name.clone(), mapped.clone());
                    Some(mapped)
                }
            }
            Some(Ok(Err(e))) => {
                let err_str = e.to_string();
                log::warn!("MCP server {server_name} failed to list tools: {err_str}");
                if is_transport_error(&err_str) {
                    state.mcp_reconnect_notify.notify_waiters();
                }
                if remove_mcp_server_entry(&state.mcp_servers, &server_name, peer.as_ref().unwrap())
                    .await
                {
                    removed_any = true;
                }
                None
            }
            Some(Err(_)) => {
                log::warn!(
                    "MCP server {server_name}: listing tools timed out after {} seconds",
                    timeout_duration.as_secs()
                );
                None
            }
            None => {
                log::debug!(
                    "collect_mcp_tools: server {server_name:?} not connected; using last-known tools if any"
                );
                None
            }
        };

        let tools = match fresh_tools {
            Some(tools) => tools,
            None => {
                let last_known = state.mcp_last_known_tools.lock().await;
                last_known.get(&server_name).cloned().unwrap_or_default()
            }
        };
        all_tools.extend(tools);
    }

    if let Some(initial) = initial_connections {
        let active = state.mcp_active_servers.lock().await;
        let current_names: HashSet<String> = active.keys().cloned().collect();
        drop(active);
        let current = state.mcp_servers.lock().await;
        if initial_names != current_names
            || current.len() != initial.len()
            || !initial.iter().all(|(name, peer)| {
                current
                    .get(name)
                    .is_some_and(|service| same_connection(service, peer))
            })
        {
            return Err("MCP inventory changed during discovery; retry".into());
        }
    }

    if removed_any {
        if let Err(e) = app.emit("mcp-update", json!({ "server": "tools-refresh" })) {
            log::error!("Failed to emit mcp-update event: {e}");
        }
    }

    Ok(all_tools)
}

/// Explicit validation is scoped to the requested active connection and live
/// tool schema. Rival inventories and name collisions affect advertisement and
/// legacy unnamed routing, not server-bound execution (which never falls back).
async fn collect_validation_tools(
    state: &AppState,
    server_name: &str,
    tool_name: &str,
) -> Result<Vec<ToolWithServer>, String> {
    let timeout_duration = tool_call_timeout(state).await;
    let peer = {
        let servers = state.mcp_servers.lock().await;
        let active = state.mcp_active_servers.lock().await;
        if !active.contains_key(server_name) {
            return Err(format!("MCP validation target '{server_name}' is disabled"));
        }
        let peer = servers
            .get(server_name)
            .filter(|service| !service.is_closed())
            .map(|service| service.peer().clone())
            .ok_or_else(|| format!("MCP validation target '{server_name}' is disconnected"))?;
        peer
    };
    let tools = timeout(timeout_duration, list_live_tools(&peer))
        .await
        .map_err(|_| format!("Fresh MCP discovery timed out for server '{server_name}'"))?
        .map_err(|_| format!("Fresh MCP discovery failed for server '{server_name}'"))?;
    let fresh: Vec<ToolWithServer> = tools
        .into_iter()
        .map(|tool| ToolWithServer {
            name: tool.name.to_string(),
            description: tool.description.as_ref().map(|d| d.to_string()),
            input_schema: Value::Object((*tool.input_schema).clone()),
            server: server_name.to_owned(),
        })
        .collect();

    // No remote await while holding these short lifecycle-ordered guards.
    // Only the target must still be enabled and on the same connection.
    let servers = state.mcp_servers.lock().await;
    let active = state.mcp_active_servers.lock().await;
    if !active.contains_key(server_name)
        || !servers
            .get(server_name)
            .is_some_and(|service| same_connection(service, &peer))
    {
        return Err("MCP inventory changed during discovery; retry".into());
    }
    if !fresh.iter().any(|tool| tool.name == tool_name) {
        return Err(format!(
            "MCP tool '{tool_name}' is unavailable on server '{server_name}'"
        ));
    }
    state
        .mcp_last_known_tools
        .lock()
        .await
        .insert(server_name.to_owned(), fresh.clone());
    Ok(fresh)
}

fn is_transport_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("transport closed")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("channel closed")
        || lower.contains("transport error")
}

async fn cleanup_cancellation_token(
    state: &State<'_, AppState>,
    cancellation_token: &Option<String>,
) {
    if let Some(token) = cancellation_token {
        let mut cancellations = state.tool_call_cancellations.lock().await;
        cancellations.remove(token);
    }
}

#[tauri::command]
pub async fn activate_mcp_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
    config: Value,
) -> Result<(), String> {
    let servers: SharedMcpServers = state.mcp_servers.clone();

    // Use the modified start_mcp_server that returns first attempt result
    start_mcp_server(app, servers, name, config).await
}

#[tauri::command]
pub async fn deactivate_mcp_server<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
) -> Result<(), String> {
    log::info!("Deactivating MCP server: {name}");

    // Get port from config before removing (for lock file cleanup later)
    let bridge_port = if name == "Jan Browser MCP" {
        let active_servers = state.mcp_active_servers.lock().await;
        active_servers.get(&name).and_then(|config| {
            config
                .get("env")
                .and_then(|envs| envs.get("BRIDGE_PORT"))
                .and_then(|port| port.as_str())
                .and_then(|port_str| port_str.parse::<u16>().ok())
        })
    } else {
        None
    };

    // First, mark server as manually deactivated
    // Remove from active servers list
    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.remove(&name);
        log::info!("Removed MCP server {name} from active servers list");
    }

    // Explicit deactivation is the only thing that should drop the last-known
    // tool schema — a transient disconnect must not (collect_mcp_tools keeps
    // serving it until the server is actually turned off).
    {
        let mut last_known = state.mcp_last_known_tools.lock().await;
        last_known.remove(&name);
    }

    // Now remove and stop the server
    let servers = state.mcp_servers.clone();
    let mut servers_map = servers.lock().await;

    let service = servers_map
        .remove(&name)
        .ok_or_else(|| format!("Server {name} not found"))?;

    // Release the lock before calling cancel
    drop(servers_map);

    log::info!("Stopping server {name}...");
    service.cancel().await.map_err(|e| e.to_string())?;

    let child_pid = {
        let mut pids = state.mcp_server_pids.lock().await;
        pids.remove(&name)
    };
    // Reap the process group and confirm the port is released, then drop the lock.
    if name == "Jan Browser MCP" {
        if let Some(port) = bridge_port {
            use crate::core::mcp::lockfile::delete_lock_file;

            terminate_browser_mcp(child_pid, port).await;

            if let Err(e) = delete_lock_file(&app, port) {
                log::warn!("Failed to delete lock file for port {}: {}", port, e);
            }
        }
    }

    log::info!("Server {name} stopped successfully and marked as deactivated.");

    // Emit mcp-update event so frontend can refresh tools list
    if let Err(e) = app.emit(
        "mcp-update",
        serde_json::json!({
            "server": name
        }),
    ) {
        log::error!("Failed to emit mcp-update event: {e}");
    }

    Ok(())
}

#[tauri::command]
pub async fn restart_mcp_servers<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use super::helpers::{stop_mcp_servers_with_context, ShutdownContext};

    let servers = state.mcp_servers.clone();

    stop_mcp_servers_with_context(&app, &state, ShutdownContext::ManualRestart).await?;

    // Restart only previously active servers (like cortex)
    restart_active_mcp_servers(&app, servers).await?;

    app.emit("mcp-update", "MCP servers updated")
        .map_err(|e| format!("Failed to emit event: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn get_connected_servers(
    _app: AppHandle<impl Runtime>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let servers = state.mcp_servers.clone();
    let servers_map = servers.lock().await;
    Ok(servers_map.keys().cloned().collect())
}

/// Remove an MCP server entry and cancel its running service (used when list-tools fails).
async fn remove_mcp_server_entry(
    mcp_servers: &SharedMcpServers,
    server_name: &str,
    peer: &McpPeer,
) -> bool {
    let removed = {
        let mut servers = mcp_servers.lock().await;
        // A failed old discovery must never remove a replacement connection.
        let matches = servers.get(server_name).is_some_and(|service| {
            match (service.peer_info(), peer.peer_info()) {
                (Some(current), Some(snapshot)) => Arc::ptr_eq(&current, &snapshot),
                _ => false,
            }
        });
        if matches {
            servers.remove(server_name)
        } else {
            None
        }
    };
    if let Some(service) = removed {
        let _ = service.cancel().await;
        true
    } else {
        false
    }
}

/// Retrieves all available tools from all MCP servers with server information
///
/// # Arguments
/// * `state` - Application state containing MCP server connections
///
/// # Returns
/// * `Result<Vec<Tool>, String>` - A vector of all tools if successful, or an error message if failed
///
/// This function:
/// 1. Locks the MCP servers mutex to access server connections
/// 2. Iterates through all connected servers
/// 3. Gets the list of tools from each server
/// 4. Associates each tool with its parent server name
/// 5. Combines all tools into a single vector
/// 6. Returns the combined list of all available tools with server information
#[tauri::command]
pub async fn get_tools<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    fresh_only: Option<bool>,
    validation_server: Option<String>,
    validation_tool: Option<String>,
) -> Result<Vec<ToolWithServer>, String> {
    match (validation_server, validation_tool) {
        (Some(server), Some(tool)) if !server.trim().is_empty() && !tool.trim().is_empty() => {
            return collect_validation_tools(&state, &server, &tool).await;
        }
        (None, None) => {}
        _ => {
            return Err("MCP validation requires both validation_server and validation_tool".into())
        }
    }
    collect_mcp_tools(&app, &state, None, fresh_only.unwrap_or(false)).await
}

/// Retrieves tools from a specific subset of MCP servers by name.
/// Unknown or disconnected names are ignored; transport failures match `get_tools` cleanup.
#[tauri::command]
pub async fn get_tools_for_servers<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    server_names: Vec<String>,
) -> Result<Vec<ToolWithServer>, String> {
    let mut seen = HashSet::new();
    let mut unique: Vec<String> = Vec::new();
    for n in server_names {
        if seen.insert(n.clone()) {
            unique.push(n);
        }
    }
    let filter: HashSet<String> = unique.into_iter().collect();
    if filter.is_empty() {
        return Ok(Vec::new());
    }
    collect_mcp_tools(&app, &state, Some(filter), false).await
}

/// Returns name, capability tags, and description for all enabled MCP servers
/// (regardless of live connection state — see `collect_mcp_tools`).
#[tauri::command]
pub async fn get_server_summaries(
    state: State<'_, AppState>,
) -> Result<Vec<ServerSummary>, String> {
    let active_servers = state.mcp_active_servers.lock().await;
    let mut summaries = Vec::new();

    for name in active_servers.keys() {
        let config = active_servers.get(name);

        let capabilities: Vec<String> = config
            .and_then(|c| c.get("capabilities"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let description: String = config
            .and_then(|c| c.get("description"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        summaries.push(ServerSummary {
            name: name.clone(),
            capabilities,
            description,
        });
    }

    Ok(summaries)
}

/// Resolve discovered matches before dispatching: legacy unqualified calls must
/// never depend on HashMap iteration order, and a named call must never fall back.
fn select_tool_server<'a>(
    tool_name: &str,
    server_name: Option<&str>,
    matching_servers: &[&'a str],
) -> Result<Option<&'a str>, String> {
    if let Some(server) = server_name {
        return Ok(matching_servers
            .iter()
            .copied()
            .find(|name| *name == server));
    }

    match matching_servers {
        [] => Ok(None),
        [server] => Ok(Some(*server)),
        _ => {
            let mut names = matching_servers.to_vec();
            names.sort_unstable();
            Err(format!(
                "Tool '{tool_name}' is ambiguous across MCP servers [{}]; specify server_name",
                names.join(", ")
            ))
        }
    }
}

/// Cancellation covers mutex acquisition as well as discovery and execution.
/// Start the shared discovery/execution budget only after acquiring the snapshot;
/// dropping the losing future releases a queued waiter or the remote operation.
/// The snapshot owns handles only; it must not retain the global map guard.
async fn run_tool_call<T, G, F>(
    tool_name: &str,
    timeout_duration: Duration,
    cancellation_enabled: bool,
    cancel_rx: oneshot::Receiver<()>,
    acquire: impl std::future::Future<Output = G>,
    operation: impl FnOnce(G) -> F,
) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    let timed_operation = async {
        let guard = acquire.await;
        timeout(timeout_duration, operation(guard)).await
    };
    tokio::select! {
        biased;
        _ = cancel_rx, if cancellation_enabled => {
            Err(format!("Tool call '{tool_name}' was cancelled"))
        }
        result = timed_operation => {
            result.unwrap_or_else(|_| Err(format!(
                "Tool call '{tool_name}' timed out after {} seconds",
                timeout_duration.as_secs()
            )))
        }
    }
}

/// Incomplete discovery cannot prove that an unqualified name is unique.
/// Named calls also fail closed if their selected server could not be queried.
fn ensure_complete_tool_discovery(failed_servers: &[String]) -> Result<(), String> {
    if failed_servers.is_empty() {
        return Ok(());
    }
    let mut names = failed_servers.to_vec();
    names.sort_unstable();
    Err(format!(
        "Cannot safely route tool: discovery failed for MCP server(s) [{}]; retry or specify a healthy server_name",
        names.join(", ")
    ))
}

/// Calls a tool on an MCP server by name with optional arguments
///
/// # Arguments
/// * `state` - Application state containing MCP server connections
/// * `tool_name` - Name of the tool to call
/// * `server_name` - Optional name of the server to call the tool from (for disambiguation)
/// * `arguments` - Optional map of argument names to values
/// * `cancellation_token` - Optional token to allow cancellation from JS side
/// * `max_output_chars` - Optional caller-derived per-result character budget
///   (the desktop chat derives one from the active model's context window);
///   combined with the `maxToolOutputChars` setting, tighter wins
///
/// # Returns
/// * `Result<CallToolResult, String>` - Result of the tool call if successful, or error message if failed
///
/// This function:
/// 1. Locks the MCP servers mutex to access server connections
/// 2. If server_name is provided, looks for the tool in that specific server
/// 3. Otherwise, searches all servers and requires an unambiguous tool match
/// 4. When found, calls the tool on that server with the provided arguments
/// 5. Supports cancellation via cancellation_token
/// 6. Returns error if no server has the requested tool or if specified server not found
#[tauri::command]
pub async fn call_tool(
    state: State<'_, AppState>,
    tool_name: String,
    server_name: Option<String>,
    arguments: Option<Map<String, Value>>,
    cancellation_token: Option<String>,
    max_output_chars: Option<u64>,
) -> Result<CallToolResult, String> {
    let (timeout_duration, tool_output_cap) = {
        let settings = state.mcp_settings.lock().await;
        (
            settings.tool_call_timeout_duration(),
            settings.tool_output_cap(max_output_chars),
        )
    };
    // Set up cancellation if token is provided
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

    if let Some(token) = &cancellation_token {
        let mut cancellations = state.tool_call_cancellations.lock().await;
        cancellations.insert(token.clone(), cancel_tx);
    }

    let result = run_tool_call(
        &tool_name,
        timeout_duration,
        cancellation_token.is_some(),
        cancel_rx,
        snapshot_servers(&state.mcp_servers),
        |servers| {
            let tool_name = tool_name.as_str();
            let server_name = &server_name;
            let arguments = &arguments;
            let state = &state;
            async move {
                // If server_name is provided, only check that specific server
                let servers_to_check: Vec<(&String, &McpPeer)> =
                    if let Some(ref server) = server_name {
                        servers.iter().filter(|(name, _)| *name == server).collect()
                    } else {
                        servers.iter().collect()
                    };

                if servers_to_check.is_empty() {
                    if let Some(server) = &server_name {
                        return Err(format!("Server '{server}' not found"));
                    }
                    return Err(format!(
                        "Tool {tool_name} not found — no MCP servers connected"
                    ));
                }

                let mut failed_servers: Vec<String> = Vec::new();

                // Discover every match before dispatching so duplicate tool names fail closed.
                let mut matching_servers = Vec::new();
                for (srv_name, service) in servers_to_check.iter() {
                    let tools = match list_live_tools(service).await {
                        Ok(tools) => tools,
                        Err(e) => {
                            let err_str = e.to_string();
                            log::warn!(
                                "MCP server {} failed to list tools during call_tool: {}",
                                srv_name,
                                err_str
                            );
                            if is_transport_error(&err_str) {
                                state.mcp_reconnect_notify.notify_waiters();
                            }
                            failed_servers.push(srv_name.to_string());
                            continue;
                        }
                    };

                    if !tools.iter().any(|t| t.name == tool_name) {
                        continue; // Tool not found in this server, try next
                    }

                    matching_servers.push(srv_name.as_str());
                }

                ensure_complete_tool_discovery(&failed_servers)?;
                let selected_server =
                    select_tool_server(&tool_name, server_name.as_deref(), &matching_servers)?;

                if let Some(srv_name) = selected_server {
                    // Revalidate the snapshot after remote discovery. Unqualified
                    // calls must also reject newly added/removed rivals. Never
                    // route an old snapshot to a replacement under the same name.
                    {
                        let current = state.mcp_servers.lock().await;
                        let unchanged = if let Some(name) = server_name.as_deref() {
                            current
                                .get(name)
                                .zip(servers.get(name))
                                .is_some_and(|(service, peer)| same_connection(service, peer))
                        } else {
                            current.len() == servers.len()
                                && servers.iter().all(|(name, peer)| {
                                    current
                                        .get(name)
                                        .is_some_and(|service| same_connection(service, peer))
                                })
                        };
                        if !unchanged {
                            return Err("MCP inventory changed during discovery; retry".into());
                        }
                    }
                    let service = servers.get(srv_name).expect("discovered MCP server exists");
                    log::info!("Found tool {tool_name} in server {srv_name}");

                    // Call the tool with timeout and cancellation support
                    let mut params = CallToolRequestParams::new(tool_name.to_owned());
                    if let Some(args) = arguments.clone() {
                        params = params.with_arguments(args);
                    }
                    let tool_call = service.call_tool(params);

                    let result = tool_call.await.map_err(|e| e.to_string());

                    // Signal reconnect if the tool call itself hit a transport error
                    if let Err(ref e) = result {
                        if is_transport_error(e) {
                            log::warn!(
                                "MCP server {} transport error during tool call: {}",
                                srv_name,
                                e
                            );
                            state.mcp_reconnect_notify.notify_waiters();
                        }
                    }

                    // Cap here rather than at each caller: this is the single point every
                    // desktop MCP tool result passes through on its way into conversation
                    // history, so an unbounded result can never reach the model.
                    return result.map(|res| truncate_tool_result(&res, tool_output_cap));
                }

                Err(format!("Tool {tool_name} not found"))
            }
        },
    )
    .await;
    cleanup_cancellation_token(&state, &cancellation_token).await;
    result
}

/// Cancels a running tool call by its cancellation token
///
/// # Arguments
/// * `state` - Application state containing cancellation tokens
/// * `cancellation_token` - Token identifying the tool call to cancel
///
/// # Returns
/// * `Result<(), String>` - Success if token found and cancelled, error otherwise
#[tauri::command]
pub async fn cancel_tool_call(
    state: State<'_, AppState>,
    cancellation_token: String,
) -> Result<(), String> {
    let mut cancellations = state.tool_call_cancellations.lock().await;

    if let Some(cancel_tx) = cancellations.remove(&cancellation_token) {
        // Send cancellation signal - ignore if receiver is already dropped
        let _ = cancel_tx.send(());
        println!("Tool call with token {cancellation_token} cancelled");
        Ok(())
    } else {
        Err(format!("Cancellation token {cancellation_token} not found"))
    }
}

fn parse_mcp_settings(value: Option<&Value>) -> McpSettings {
    value
        .and_then(|v| serde_json::from_value::<McpSettings>(v.clone()).ok())
        .unwrap_or_default()
}

/// Read one configured server's entry out of `mcp_config.json`. Errors rather
/// than defaulting: every caller here is acting on a server the user picked, and
/// a silent empty config would report "not authenticated" for a typo.
fn read_server_config<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<Value, String> {
    let mut path = get_jan_data_folder_path(app.clone());
    path.push("mcp_config.json");
    let body = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Value>(&body)
        .map_err(|e| format!("Failed to parse mcp_config.json: {e}"))?
        .get("mcpServers")
        .and_then(|s| s.get(name))
        .cloned()
        .ok_or_else(|| format!("server '{name}' not found in mcp_config.json"))
}

/// The OAuth state of one configured server. Local only -- no network -- so the
/// settings screen can call it per row without a round trip each.
#[tauri::command]
pub async fn get_mcp_auth_status<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<oauth::AuthStatusInfo, String> {
    let config = read_server_config(&app, &name)?;
    let folder = get_jan_data_folder_path(app);
    Ok(oauth::status(&folder, &name, &config).into())
}

/// Run an interactive OAuth authorization for one server: discover the
/// provider, register a client, open the consent page, and wait for the
/// redirect on a loopback listener.
///
/// Resolves only once the flow finishes (or times out after five minutes), so
/// the caller awaits a single promise. The consent url is also emitted as
/// `mcp-oauth-url` before the wait begins, so the UI can offer it as a link
/// when the browser did not come up.
#[tauri::command]
pub async fn authorize_mcp_server<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<(), String> {
    let config = read_server_config(&app, &name)?;
    let url = config
        .get("url")
        .and_then(Value::as_str)
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| {
            format!("'{name}' is a stdio server - OAuth applies to http/sse servers only")
        })?;

    let pending = oauth::begin(&name, url).await?;
    if let Err(e) = app.emit(
        "mcp-oauth-url",
        json!({ "server": &name, "url": &pending.authorization_url }),
    ) {
        log::error!("Failed to emit mcp-oauth-url event: {e}");
    }
    // Best-effort: the url has already been emitted, so a session with no
    // browser can still finish by opening it by hand. Only http(s) is handed
    // to the system opener, which would otherwise launch whatever handles the
    // scheme.
    if !oauth::is_allowed_oauth_url(&pending.authorization_url) {
        return Err(format!("'{name}' produced a sign-in URL Jan will not open"));
    }
    if let Err(e) = app
        .opener()
        .open_url(&pending.authorization_url, None::<&str>)
    {
        log::warn!("Could not open the browser for '{name}': {e}");
    }

    let folder = get_jan_data_folder_path(app);
    pending.complete(&folder).await.map(|_| ())
}

/// Forget one server's stored tokens. `false` when there were none, so the UI
/// can tell "cleared" from "nothing to clear".
#[tauri::command]
pub async fn clear_mcp_auth<R: Runtime>(app: AppHandle<R>, name: String) -> Result<bool, String> {
    let folder = get_jan_data_folder_path(app);
    oauth::clear(&folder, &name)
}

#[tauri::command]
pub async fn get_mcp_configs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let mut path = get_jan_data_folder_path(app.clone());
    path.push("mcp_config.json");

    // Create default empty config if file doesn't exist
    if !path.exists() {
        log::info!("mcp_config.json not found, creating default empty config");
        fs::write(&path, DEFAULT_MCP_CONFIG)
            .map_err(|e| format!("Failed to create default MCP config: {e}"))?;
    }

    let config_string = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let mut config_value: Value = if config_string.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&config_string).unwrap_or_else(|error| {
            log::error!("Failed to parse existing MCP config, regenerating defaults: {error}");
            json!({})
        })
    };

    if !config_value.is_object() {
        config_value = json!({});
    }

    let mut mutated = false;
    let config_object = config_value.as_object_mut().unwrap();

    let settings = parse_mcp_settings(config_object.get("mcpSettings"));
    if !config_object.contains_key("mcpSettings") {
        config_object.insert(
            "mcpSettings".to_string(),
            serde_json::to_value(&settings)
                .map_err(|e| format!("Failed to serialize MCP settings: {e}"))?,
        );
        mutated = true;
    }

    if !config_object.contains_key("mcpServers") {
        config_object.insert("mcpServers".to_string(), json!({}));
        mutated = true;
    }

    // Migration: Add Jan Browser MCP if not present
    let mcp_servers = config_object
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .ok_or("mcpServers is not an object")?;

    if !mcp_servers.contains_key("Jan Browser MCP") {
        log::info!("Migrating config: Adding 'Jan Browser MCP' server");
        mcp_servers.insert(
            "Jan Browser MCP".to_string(),
            json!({
                "command": "npx",
                "args": ["-y", "search-mcp-server@latest"],
                "env": {
                    "BRIDGE_HOST": "127.0.0.1",
                    "BRIDGE_PORT": "17389"
                },
                "active": false,
                "official": true
            }),
        );
        mutated = true;
    }

    // Persist any mutations back to disk
    if mutated {
        fs::write(
            &path,
            serde_json::to_string_pretty(&config_value)
                .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
        )
        .map_err(|e| format!("Failed to write MCP config: {e}"))?;
    }

    // Update in-memory state with latest settings
    {
        let state = app.state::<AppState>();
        let mut settings_guard = state.mcp_settings.lock().await;
        *settings_guard = settings.clone();
    }

    serde_json::to_string_pretty(&config_value)
        .map_err(|e| format!("Failed to serialize MCP config: {e}"))
}

/// Check if error indicates extension not connected
pub(crate) fn is_extension_not_connected_error(text: &str) -> bool {
    const PATTERNS: &[&str] = &[
        "not connected to bridge",
        "not responding to ping",
        "extension not connected",
    ];
    const KEYWORD_PAIRS: &[(&str, &str)] = &[
        ("browser", "not connected"),
        ("browser", "not responding"),
        ("tool", "not found"),
    ];

    let text_lower = text.to_lowercase();
    PATTERNS.iter().any(|p| text_lower.contains(p))
        || KEYWORD_PAIRS
            .iter()
            .any(|(a, b)| text_lower.contains(a) && text_lower.contains(b))
}

/// Extract text response from tool result
fn get_result_text(result: &rmcp::model::CallToolResult) -> Option<&str> {
    result
        .content
        .first()
        .and_then(|c| c.as_text())
        .map(|t| t.text.as_str())
}

/// Check if Jan Browser extension is connected via MCP
#[tauri::command]
pub async fn check_jan_browser_extension_connected(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let peer = {
        let servers = state.mcp_servers.lock().await;
        servers
            .get("Jan Browser MCP")
            .map(|service| service.peer().clone())
    };
    let Some(service) = peer.as_ref() else {
        return Ok(false);
    };

    // Check available tools
    let tools = match timeout(Duration::from_secs(2), list_live_tools(service)).await {
        Ok(Ok(tools)) if !tools.is_empty() => tools,
        _ => return Ok(false),
    };

    let has_ping = tools.iter().any(|t| t.name == "ping");

    // Try simple ping first if available
    if has_ping {
        match try_ping_tool(service).await {
            PingResult::Connected => return Ok(true),
            PingResult::NotConnected => return Ok(false),
            PingResult::ToolNotAvailable => {
                log::debug!("ping unavailable, trying browser_snapshot");
            }
        }
    }

    // Fallback to browser_snapshot
    try_browser_snapshot_tool(service).await
}

enum PingResult {
    Connected,
    NotConnected,
    ToolNotAvailable,
}

async fn try_ping_tool(service: &McpPeer) -> PingResult {
    let result = timeout(
        Duration::from_secs(3),
        service.call_tool(CallToolRequestParams::new("ping").with_arguments(Map::new())),
    )
    .await;

    match result {
        Ok(Ok(res)) => {
            if let Some(text) = get_result_text(&res) {
                if text == "pong" {
                    return PingResult::Connected;
                }
                if is_extension_not_connected_error(text) {
                    return PingResult::NotConnected;
                }
            }
            if res.is_error == Some(true) {
                return PingResult::NotConnected;
            }
            PingResult::Connected
        }
        Ok(Err(e)) => {
            if is_extension_not_connected_error(&e.to_string()) {
                PingResult::NotConnected
            } else {
                PingResult::ToolNotAvailable
            }
        }
        Err(_) => PingResult::NotConnected,
    }
}

async fn try_browser_snapshot_tool(service: &McpPeer) -> Result<bool, String> {
    let result = timeout(
        // Snapshot tool is very time-consuming
        // Extend timeout to make sure the tool call has enough time to succeed
        Duration::from_secs(20),
        service
            .call_tool(CallToolRequestParams::new("browser_snapshot").with_arguments(Map::new())),
    )
    .await;

    match result {
        Ok(Ok(res)) => {
            if res.is_error == Some(true) {
                if let Some(text) = get_result_text(&res) {
                    if is_extension_not_connected_error(text) {
                        return Ok(false);
                    }
                }
            }
            Ok(true)
        }
        Ok(Err(_)) | Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn save_mcp_configs<R: Runtime>(
    app: AppHandle<R>,
    configs: String,
) -> Result<(), String> {
    let mut path = get_jan_data_folder_path(app.clone());
    path.push("mcp_config.json");
    log::info!("save mcp configs, path: {path:?}");

    let mut config_value: Value =
        serde_json::from_str(&configs).map_err(|e| format!("Invalid MCP config payload: {e}"))?;

    if !config_value.is_object() {
        return Err("MCP config must be a JSON object".to_string());
    }

    let config_object = config_value.as_object_mut().unwrap();
    let settings = parse_mcp_settings(config_object.get("mcpSettings"));

    if !config_object.contains_key("mcpSettings") {
        config_object.insert(
            "mcpSettings".to_string(),
            serde_json::to_value(&settings).expect("Failed to serialize MCP settings"),
        );
    }

    if !config_object.contains_key("mcpServers") {
        config_object.insert("mcpServers".to_string(), json!({}));
    }

    fs::write(
        &path,
        serde_json::to_string_pretty(&config_value)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?,
    )
    .map_err(|e| e.to_string())?;

    {
        let state = app.state::<AppState>();
        let mut settings_guard = state.mcp_settings.lock().await;
        *settings_guard = settings;
    }

    Ok(())
}

#[cfg(test)]
mod call_tool_routing_tests {
    use super::{ensure_complete_tool_discovery, run_tool_call, select_tool_server};
    use std::{future::pending, time::Duration};
    use tokio::sync::{oneshot, Mutex};

    #[tokio::test]
    async fn fresh_inventory_rejects_disconnected_last_known_advertisement() {
        use tauri::Manager;
        let app = tauri::test::mock_app();
        app.manage(crate::core::state::AppState::default());
        let state = app.state::<crate::core::state::AppState>();
        state
            .mcp_active_servers
            .lock()
            .await
            .insert("alpha".into(), serde_json::json!({}));
        state.mcp_last_known_tools.lock().await.insert(
            "alpha".into(),
            vec![crate::core::mcp::models::ToolWithServer {
                name: "search".into(),
                server: "alpha".into(),
                description: None,
                input_schema: serde_json::json!({}),
            }],
        );
        assert_eq!(
            super::collect_mcp_tools(app.handle(), &state, None, false)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(super::collect_mcp_tools(app.handle(), &state, None, true)
            .await
            .unwrap_err()
            .contains("disconnected"));
    }

    #[derive(Clone)]
    struct ValidationServer {
        entered: std::sync::Arc<tokio::sync::Notify>,
        release: Option<std::sync::Arc<tokio::sync::Notify>>,
    }

    impl rmcp::ServerHandler for ValidationServer {
        fn get_info(&self) -> rmcp::model::ServerInfo {
            rmcp::model::ServerInfo::new(
                rmcp::model::ServerCapabilities::builder()
                    .enable_tools()
                    .build(),
            )
        }

        async fn call_tool(
            &self,
            _: rmcp::model::CallToolRequestParams,
            _: rmcp::service::RequestContext<rmcp::RoleServer>,
        ) -> Result<rmcp::model::CallToolResponse, rmcp::ErrorData> {
            Ok(rmcp::model::CallToolResult::success(vec![]).into())
        }

        async fn list_tools(
            &self,
            _: Option<rmcp::model::PaginatedRequestParams>,
            _: rmcp::service::RequestContext<rmcp::RoleServer>,
        ) -> Result<rmcp::model::ListToolsResult, rmcp::ErrorData> {
            self.entered.notify_one();
            if let Some(release) = &self.release {
                release.notified().await;
            }
            Ok(rmcp::model::ListToolsResult::with_all_items(vec![
                rmcp::model::Tool::new("search", "fixture", serde_json::Map::new()),
            ]))
        }
    }

    async fn validation_connection(
        release: Option<std::sync::Arc<tokio::sync::Notify>>,
    ) -> (
        crate::core::state::RunningMcpService,
        std::sync::Arc<tokio::sync::Notify>,
    ) {
        use rmcp::ServiceExt;
        let entered = std::sync::Arc::new(tokio::sync::Notify::new());
        let server = ValidationServer {
            entered: entered.clone(),
            release,
        };
        let (server_io, client_io) = tokio::io::duplex(8192);
        tokio::spawn(async move {
            let running = server.serve(server_io).await.unwrap();
            let _ = running.waiting().await;
        });
        let app = tauri::test::mock_app();
        let client = super::super::progress::JanClientHandler::new(
            super::super::helpers::jan_client_info(),
            "alpha".into(),
            app.handle().clone(),
        )
        .serve(client_io)
        .await
        .unwrap();
        (client, entered)
    }

    fn cached_tool(name: &str, server: &str) -> crate::core::mcp::models::ToolWithServer {
        crate::core::mcp::models::ToolWithServer {
            name: name.into(),
            server: server.into(),
            description: None,
            input_schema: serde_json::json!({}),
        }
    }

    #[tokio::test]
    async fn targeted_inventory_ignores_never_listed_offline_and_colliding_rivals() {
        let state = crate::core::state::AppState::default();
        let (client, _) = validation_connection(None).await;
        state
            .mcp_servers
            .lock()
            .await
            .insert("alpha".into(), client);
        for name in ["alpha", "beta"] {
            state
                .mcp_active_servers
                .lock()
                .await
                .insert(name.into(), serde_json::json!({}));
        }
        // Enabled, never-listed, offline beta must not block explicit alpha.
        let inventory = super::collect_validation_tools(&state, "alpha", "search")
            .await
            .unwrap();
        assert_eq!(inventory.len(), 1);
        assert_eq!(inventory[0].server, "alpha");
        assert_eq!(inventory[0].name, "search");
        // Even a known same-name rival is irrelevant to server-bound execution.
        state
            .mcp_last_known_tools
            .lock()
            .await
            .insert("beta".into(), vec![cached_tool("search", "beta")]);
        let inventory = super::collect_validation_tools(&state, "alpha", "search")
            .await
            .unwrap();
        assert_eq!(inventory.len(), 1);
        assert_eq!(inventory[0].server, "alpha");
        assert!(super::collect_validation_tools(&state, "alpha", "missing")
            .await
            .unwrap_err()
            .contains("unavailable"));
        let client = state.mcp_servers.lock().await.remove("alpha").unwrap();
        client.cancel().await.unwrap();
        assert!(super::collect_validation_tools(&state, "alpha", "search")
            .await
            .unwrap_err()
            .contains("disconnected"));
        state.mcp_active_servers.lock().await.remove("alpha");
        assert!(super::collect_validation_tools(&state, "alpha", "search")
            .await
            .unwrap_err()
            .contains("disabled"));
    }

    #[tokio::test]
    async fn targeted_inventory_rejects_replacement_or_disabling_during_discovery() {
        use std::sync::Arc;
        for replace in [true, false] {
            let state = crate::core::state::AppState::default();
            let release = Arc::new(tokio::sync::Notify::new());
            let (client, entered) = validation_connection(Some(release.clone())).await;
            state
                .mcp_servers
                .lock()
                .await
                .insert("alpha".into(), client);
            state
                .mcp_active_servers
                .lock()
                .await
                .insert("alpha".into(), serde_json::json!({}));
            let discovery = super::collect_validation_tools(&state, "alpha", "search");
            tokio::pin!(discovery);
            assert_pending(discovery.as_mut()).await;
            entered.notified().await;
            // An in-flight transport request holds no global lock.
            assert!(state.mcp_servers.try_lock().is_ok());
            let old = if replace {
                let (replacement, _) = validation_connection(None).await;
                state
                    .mcp_servers
                    .lock()
                    .await
                    .insert("alpha".into(), replacement)
            } else {
                state.mcp_active_servers.lock().await.remove("alpha");
                None
            };
            release.notify_one();
            assert!(discovery
                .await
                .unwrap_err()
                .contains("changed during discovery"));
            assert!(!state
                .mcp_last_known_tools
                .lock()
                .await
                .contains_key("alpha"));
            if let Some(old) = old {
                old.cancel().await.unwrap();
            }
            let client = state.mcp_servers.lock().await.remove("alpha").unwrap();
            client.cancel().await.unwrap();
        }
    }

    #[tokio::test]
    async fn duplex_explicit_dispatch_ignores_collisions_but_legacy_unnamed_rejects_them() {
        use tauri::Manager;
        let app = tauri::test::mock_app();
        app.manage(crate::core::state::AppState::default());
        let state = app.state::<crate::core::state::AppState>();
        for name in ["alpha", "beta"] {
            let (client, _) = validation_connection(None).await;
            state.mcp_servers.lock().await.insert(name.into(), client);
            state
                .mcp_active_servers
                .lock()
                .await
                .insert(name.into(), serde_json::json!({}));
        }
        assert!(super::call_tool(
            state.clone(),
            "search".into(),
            Some("alpha".into()),
            None,
            None,
            None
        )
        .await
        .is_ok());
        assert!(
            super::call_tool(state.clone(), "search".into(), None, None, None, None)
                .await
                .unwrap_err()
                .contains("ambiguous")
        );
        assert!(super::call_tool(
            state.clone(),
            "search".into(),
            Some("missing".into()),
            None,
            None,
            None
        )
        .await
        .unwrap_err()
        .contains("not found"));
        let clients = std::mem::take(&mut *state.mcp_servers.lock().await);
        for (_, client) in clients {
            client.cancel().await.unwrap();
        }
    }

    #[tokio::test]
    async fn targeted_inventory_ignores_unrelated_activation_during_discovery() {
        use std::sync::Arc;
        let state = crate::core::state::AppState::default();
        let release = Arc::new(tokio::sync::Notify::new());
        let (client, entered) = validation_connection(Some(release.clone())).await;
        state
            .mcp_servers
            .lock()
            .await
            .insert("alpha".into(), client);
        state
            .mcp_active_servers
            .lock()
            .await
            .insert("alpha".into(), serde_json::json!({}));
        let discovery = super::collect_validation_tools(&state, "alpha", "search");
        tokio::pin!(discovery);
        assert_pending(discovery.as_mut()).await;
        entered.notified().await;
        state
            .mcp_active_servers
            .lock()
            .await
            .insert("beta".into(), serde_json::json!({}));
        release.notify_one();
        let inventory = discovery.await.unwrap();
        assert_eq!(inventory.len(), 1);
        assert_eq!(inventory[0].server, "alpha");
        state
            .mcp_servers
            .lock()
            .await
            .remove("alpha")
            .unwrap()
            .cancel()
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn nonfresh_inventory_keeps_cache_on_midlisting_disconnect_or_replacement() {
        use std::sync::Arc;
        for fresh_only in [false, true] {
            for replace in [false, true] {
                let app = tauri::test::mock_app();
                let state = crate::core::state::AppState::default();
                let release = Arc::new(tokio::sync::Notify::new());
                let (client, entered) = validation_connection(Some(release.clone())).await;
                state
                    .mcp_servers
                    .lock()
                    .await
                    .insert("alpha".into(), client);
                state
                    .mcp_active_servers
                    .lock()
                    .await
                    .insert("alpha".into(), serde_json::json!({}));
                state
                    .mcp_last_known_tools
                    .lock()
                    .await
                    .insert("alpha".into(), vec![cached_tool("cached", "alpha")]);
                let discovery = super::collect_mcp_tools(app.handle(), &state, None, fresh_only);
                tokio::pin!(discovery);
                assert_pending(discovery.as_mut()).await;
                entered.notified().await;
                // Keep the old transport alive so it can return a successful
                // response after the registered connection changes.
                let old = state.mcp_servers.lock().await.remove("alpha").unwrap();
                if replace {
                    let (replacement, _) = validation_connection(None).await;
                    state
                        .mcp_servers
                        .lock()
                        .await
                        .insert("alpha".into(), replacement);
                }
                release.notify_one();
                let result = discovery.await;
                if fresh_only {
                    assert!(result.unwrap_err().contains("changed during discovery"));
                } else {
                    let inventory = result.unwrap();
                    assert_eq!(inventory.len(), 1);
                    assert_eq!(inventory[0].name, "cached");
                }
                assert_eq!(
                    state.mcp_last_known_tools.lock().await["alpha"][0].name,
                    "cached"
                );
                old.cancel().await.unwrap();
                let replacement = state.mcp_servers.lock().await.remove("alpha");
                if let Some(client) = replacement {
                    client.cancel().await.unwrap();
                }
            }
        }
    }

    // Controlled fake remote gates use the exact production snapshot helper and
    // cancellation/budget wrapper. No sleeps, providers, or installed MCP data.
    #[tokio::test]
    async fn long_tool_a_does_not_block_fresh_inventory_or_tool_b() {
        use super::snapshot_handles;
        use std::{collections::HashMap, sync::Arc};
        let servers = Mutex::new(HashMap::from([
            ("alpha".into(), Arc::new(())),
            ("beta".into(), Arc::new(())),
        ]));
        let (finish_a, wait_a) = oneshot::channel::<()>();
        let (_cancel, rx) = oneshot::channel();
        let a = run_tool_call(
            "a",
            Duration::from_secs(60),
            false,
            rx,
            snapshot_handles(&servers, Arc::clone),
            |snapshot| async move {
                assert!(snapshot.contains_key("alpha"));
                wait_a.await.unwrap(); // fake long execution
                Ok(())
            },
        );
        tokio::pin!(a);
        assert_pending(a.as_mut()).await;
        // Validation observes a newly connected rival, not A's frozen handles.
        servers
            .try_lock()
            .unwrap()
            .insert("rival".into(), Arc::new(()));
        let inventory = snapshot_handles(&servers, Arc::clone).await;
        assert_eq!(inventory.len(), 3);
        let (_cancel_b, rx_b) = oneshot::channel();
        let b = run_tool_call(
            "b",
            Duration::from_secs(1),
            false,
            rx_b,
            snapshot_handles(&servers, Arc::clone),
            |snapshot| async move {
                assert!(snapshot.contains_key("beta"));
                Ok(42)
            },
        );
        assert_eq!(b.await, Ok(42));
        assert_pending(a.as_mut()).await;
        finish_a.send(()).unwrap();
        assert_eq!(a.await, Ok(()));
    }

    #[tokio::test]
    async fn stop_cancels_snapshot_discovery_and_execution_without_late_dispatch() {
        use super::snapshot_handles;
        use std::{
            collections::HashMap,
            sync::{
                atomic::{AtomicUsize, Ordering},
                Arc,
            },
        };
        for executing in [false, true] {
            let servers = Mutex::new(HashMap::from([("alpha".into(), Arc::new(()))]));
            let dispatched = AtomicUsize::new(0);
            let completed = AtomicUsize::new(0);
            let (release, gate) = oneshot::channel::<()>();
            let (stop, rx) = oneshot::channel();
            let call = run_tool_call(
                "a",
                Duration::from_secs(60),
                true,
                rx,
                snapshot_handles(&servers, Arc::clone),
                |_| async {
                    if executing {
                        dispatched.fetch_add(1, Ordering::SeqCst);
                    }
                    let _ = gate.await; // fake discovery or execution
                    if !executing {
                        dispatched.fetch_add(1, Ordering::SeqCst);
                    }
                    completed.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            );
            tokio::pin!(call);
            assert_pending(call.as_mut()).await;
            assert!(
                servers.try_lock().is_ok(),
                "remote gate must not retain map lock"
            );
            stop.send(()).unwrap();
            assert!(call.await.unwrap_err().contains("cancelled"));
            assert!(
                release.send(()).is_err(),
                "Stop dropped remote gate; no late dispatch"
            );
            assert_eq!(dispatched.load(Ordering::SeqCst), usize::from(executing));
            assert_eq!(completed.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn failed_rival_prevents_legacy_unnamed_dispatch_to_the_survivor() {
        for matches in [vec!["alpha"], vec![]] {
            let result = ensure_complete_tool_discovery(&["beta".into()])
                .and_then(|()| select_tool_server("search", None, &matches));
            assert!(result.unwrap_err().contains("discovery failed"));
        }
        assert!(ensure_complete_tool_discovery(&[]).is_ok());
    }

    // Poll once without relying on scheduler timing or wall-clock sleeps.
    async fn assert_pending<F: std::future::Future>(mut future: std::pin::Pin<&mut F>) {
        assert!(
            std::future::poll_fn(|cx| {
                std::task::Poll::Ready(future.as_mut().poll(cx).is_pending())
            })
            .await
        );
    }

    #[tokio::test(start_paused = true)]
    async fn discovery_timeout_releases_lock_without_dispatch() {
        let mutex = Mutex::new(());
        let (_tx, rx) = oneshot::channel();
        let mut dispatched = false;
        let result = run_tool_call(
            "search",
            Duration::from_secs(10),
            false,
            rx,
            mutex.lock(),
            |guard| async {
                let _guard = guard;
                pending::<()>().await; // controlled hanging list_all_tools
                dispatched = true;
                Ok(())
            },
        )
        .await;
        assert!(result.unwrap_err().contains("timed out"));
        assert!(!dispatched);
        assert!(
            mutex.try_lock().is_ok(),
            "timeout must drop the discovery guard"
        );
    }

    #[tokio::test]
    async fn discovery_cancellation_releases_lock_without_dispatch() {
        let mutex = Mutex::new(());
        let (tx, rx) = oneshot::channel();
        let mut dispatched = false;
        {
            let call = run_tool_call(
                "search",
                Duration::from_secs(5),
                true,
                rx,
                mutex.lock(),
                |guard| async {
                    let _guard = guard;
                    pending::<()>().await;
                    dispatched = true;
                    Ok(())
                },
            );
            tokio::pin!(call);
            assert_pending(call.as_mut()).await;
            assert!(mutex.try_lock().is_err(), "discovery must hold the guard");
            tx.send(()).unwrap();
            assert!(call.await.unwrap_err().contains("cancelled"));
        }
        assert!(!dispatched);
        assert!(mutex.try_lock().is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn queued_call_gets_full_discovery_and_execution_budget() {
        let mutex = Mutex::new(());
        let guard = mutex.lock().await;
        let (_tx, rx) = oneshot::channel();
        let call = run_tool_call(
            "search",
            Duration::from_secs(10),
            false,
            rx,
            mutex.lock(),
            |guard| async {
                let _guard = guard;
                tokio::time::sleep(Duration::from_secs(6)).await; // discovery
                tokio::time::sleep(Duration::from_secs(3)).await; // execution
                Ok(42)
            },
        );
        tokio::pin!(call);
        assert_pending(call.as_mut()).await; // queued behind the first call
        tokio::time::advance(Duration::from_secs(20)).await;
        assert_pending(call.as_mut()).await; // waiting does not consume the budget
        drop(guard);
        assert_pending(call.as_mut()).await; // start discovery and its budget
        tokio::time::advance(Duration::from_secs(6)).await;
        assert_pending(call.as_mut()).await; // start execution, six seconds used
        tokio::time::advance(Duration::from_secs(3)).await;
        assert_eq!(call.await, Ok(42));
        assert!(mutex.try_lock().is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn discovery_and_execution_share_one_timeout_budget() {
        let mutex = Mutex::new(());
        let (_tx, rx) = oneshot::channel();
        let call = run_tool_call(
            "search",
            Duration::from_secs(10),
            false,
            rx,
            mutex.lock(),
            |guard| async {
                let _guard = guard;
                tokio::time::sleep(Duration::from_secs(6)).await;
                tokio::time::sleep(Duration::from_secs(6)).await;
                Ok(())
            },
        );
        tokio::pin!(call);
        assert_pending(call.as_mut()).await;
        tokio::time::advance(Duration::from_secs(6)).await;
        assert_pending(call.as_mut()).await;
        tokio::time::advance(Duration::from_secs(4)).await;
        assert!(call.await.unwrap_err().contains("timed out"));
        assert!(mutex.try_lock().is_ok());
    }

    #[tokio::test]
    async fn cancellation_during_mutex_wait_removes_waiter_without_late_dispatch() {
        let mutex = Mutex::new(());
        let guard = mutex.lock().await;
        let (tx, rx) = oneshot::channel();
        let mut dispatched = false;
        {
            let call = run_tool_call(
                "search",
                Duration::from_secs(5),
                true,
                rx,
                mutex.lock(),
                |guard| async {
                    let _guard = guard;
                    dispatched = true;
                    Ok(())
                },
            );
            tokio::pin!(call);
            assert_pending(call.as_mut()).await; // register the queued waiter
            tx.send(()).unwrap();
            assert!(call.await.unwrap_err().contains("cancelled"));
        }
        drop(guard);
        // A stale queued waiter would reserve the lock instead of releasing it.
        assert!(mutex.try_lock().is_ok());
        assert!(!dispatched);
    }

    #[tokio::test]
    async fn operation_succeeds_without_cancellation_token() {
        let (tx, rx) = oneshot::channel();
        drop(tx); // absent tokens must not treat a closed channel as cancellation
        assert_eq!(
            run_tool_call(
                "search",
                Duration::from_secs(1),
                false,
                rx,
                std::future::ready(()),
                |()| async { Ok(42) }
            )
            .await,
            Ok(42)
        );
    }

    #[test]
    fn legacy_call_selects_the_only_matching_server() {
        assert_eq!(
            select_tool_server("search", None, &["alpha"]),
            Ok(Some("alpha"))
        );
        assert_eq!(select_tool_server("search", None, &[]), Ok(None));
    }

    #[test]
    fn legacy_call_rejects_ambiguous_matches_in_either_order() {
        let error = select_tool_server("search", None, &["beta", "alpha"])
            .expect_err("ambiguous legacy calls must not dispatch");
        assert_eq!(
            error,
            "Tool 'search' is ambiguous across MCP servers [alpha, beta]; specify server_name"
        );
        assert_eq!(
            select_tool_server("search", None, &["alpha", "beta"]),
            Err(error)
        );
    }

    #[test]
    fn explicit_server_disambiguates_duplicate_tools() {
        assert_eq!(
            select_tool_server("search", Some("beta"), &["alpha", "beta"]),
            Ok(Some("beta"))
        );
    }

    #[test]
    fn explicit_server_never_falls_back_to_another_server() {
        assert_eq!(
            select_tool_server("search", Some("missing"), &["alpha"]),
            Ok(None)
        );
        assert_eq!(select_tool_server("search", Some("alpha"), &[]), Ok(None));
    }
}
