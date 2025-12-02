use rmcp::model::{CallToolRequestParam, CallToolResult};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::{
    constants::DEFAULT_MCP_CONFIG,
    helpers::{restart_active_mcp_servers, start_mcp_server_with_restart},
};
use crate::core::{
    app::commands::get_jan_data_folder_path,
    mcp::models::McpSettings,
    state::AppState,
};
use crate::core::{
    mcp::models::ToolWithServer,
    state::{RunningServiceEnum, SharedMcpServers},
};
use std::{fs, time::Duration};

async fn tool_call_timeout(state: &State<'_, AppState>) -> Duration {
    state
        .mcp_settings
        .lock()
        .await
        .tool_call_timeout_duration()
}

#[tauri::command]
pub async fn activate_mcp_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
    config: Value,
) -> Result<(), String> {
    let servers: SharedMcpServers = state.mcp_servers.clone();

    // Use the modified start_mcp_server_with_restart that returns first attempt result
    start_mcp_server_with_restart(app, servers, name, config, Some(3)).await
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
                .get("envs")
                .and_then(|envs| envs.get("BRIDGE_PORT"))
                .and_then(|port| port.as_str())
                .and_then(|port_str| port_str.parse::<u16>().ok())
        })
    } else {
        None
    };

    // First, mark server as manually deactivated to prevent restart
    // Remove from active servers list to prevent restart
    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.remove(&name);
        log::info!("Removed MCP server {name} from active servers list");
    }

    // Mark as not successfully connected to prevent restart logic
    {
        let mut connected = state.mcp_successfully_connected.lock().await;
        connected.insert(name.clone(), false);
        log::info!("Marked MCP server {name} as not successfully connected");
    }

    // Reset restart count
    {
        let mut counts = state.mcp_restart_counts.lock().await;
        counts.remove(&name);
        log::info!("Reset restart count for MCP server {name}");
    }

    // Now remove and stop the server
    let servers = state.mcp_servers.clone();
    let mut servers_map = servers.lock().await;

    let service = servers_map
        .remove(&name)
        .ok_or_else(|| format!("Server {name} not found"))?;

    // Release the lock before calling cancel
    drop(servers_map);

    match service {
        RunningServiceEnum::NoInit(service) => {
            log::info!("Stopping server {name}...");
            service.cancel().await.map_err(|e| e.to_string())?;
        }
        RunningServiceEnum::WithInit(service) => {
            log::info!("Stopping server {name} with initialization...");
            service.cancel().await.map_err(|e| e.to_string())?;
        }
    }

    // Delete lock file if this is Jan Browser MCP and we have a port
    if name == "Jan Browser MCP" {
        if let Some(port) = bridge_port {
            use crate::core::mcp::lockfile::delete_lock_file;

            if let Err(e) = delete_lock_file(&app, port) {
                log::warn!("Failed to delete lock file for port {}: {}", port, e);
            }
        }
    }

    log::info!("Server {name} stopped successfully and marked as deactivated.");
    Ok(())
}

#[tauri::command]
pub async fn restart_mcp_servers<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>) -> Result<(), String> {
    use super::helpers::{stop_mcp_servers_with_context, ShutdownContext};

    let servers = state.mcp_servers.clone();

    stop_mcp_servers_with_context(&app, &state, ShutdownContext::ManualRestart).await?;

    // Restart only previously active servers (like cortex)
    restart_active_mcp_servers(&app, servers).await?;

    app.emit("mcp-update", "MCP servers updated")
        .map_err(|e| format!("Failed to emit event: {e}"))?;

    Ok(())
}

/// Reset MCP restart count for a specific server (like cortex reset)
#[tauri::command]
pub async fn reset_mcp_restart_count(
    state: State<'_, AppState>,
    server_name: String,
) -> Result<(), String> {
    let mut counts = state.mcp_restart_counts.lock().await;

    let count = match counts.get_mut(&server_name) {
        Some(count) => count,
        None => return Ok(()), // Server not found, nothing to reset
    };

    let old_count = *count;
    *count = 0;
    log::info!(
        "MCP server {server_name} restart count reset from {old_count} to 0."
    );
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
pub async fn get_tools(state: State<'_, AppState>) -> Result<Vec<ToolWithServer>, String> {
    let timeout_duration = tool_call_timeout(&state).await;
    let servers = state.mcp_servers.lock().await;
    let mut all_tools: Vec<ToolWithServer> = Vec::new();

    for (server_name, service) in servers.iter() {
        // List tools with timeout
        let tools_future = service.list_all_tools();
        let tools = match timeout(timeout_duration, tools_future).await {
            Ok(result) => result.map_err(|e| e.to_string())?,
            Err(_) => {
                log::warn!(
                    "Listing tools timed out after {} seconds",
                    timeout_duration.as_secs()
                );
                continue; // Skip this server and continue with others
            }
        };

        for tool in tools {
            all_tools.push(ToolWithServer {
                name: tool.name.to_string(),
                description: tool.description.as_ref().map(|d| d.to_string()),
                input_schema: serde_json::Value::Object((*tool.input_schema).clone()),
                server: server_name.clone(),
            });
        }
    }

    Ok(all_tools)
}

/// Calls a tool on an MCP server by name with optional arguments
///
/// # Arguments
/// * `state` - Application state containing MCP server connections
/// * `tool_name` - Name of the tool to call
/// * `server_name` - Optional name of the server to call the tool from (for disambiguation)
/// * `arguments` - Optional map of argument names to values
/// * `cancellation_token` - Optional token to allow cancellation from JS side
///
/// # Returns
/// * `Result<CallToolResult, String>` - Result of the tool call if successful, or error message if failed
///
/// This function:
/// 1. Locks the MCP servers mutex to access server connections
/// 2. If server_name is provided, looks for the tool in that specific server
/// 3. Otherwise, searches through all servers for one containing the named tool
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
) -> Result<CallToolResult, String> {
    let timeout_duration = tool_call_timeout(&state).await;
    // Set up cancellation if token is provided
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

    if let Some(token) = &cancellation_token {
        let mut cancellations = state.tool_call_cancellations.lock().await;
        cancellations.insert(token.clone(), cancel_tx);
    }

    let servers = state.mcp_servers.lock().await;

    // If server_name is provided, only check that specific server
    let servers_to_check: Vec<(&String, &crate::core::state::RunningServiceEnum)> = if let Some(ref server) = server_name {
        servers.iter()
            .filter(|(name, _)| *name == server)
            .collect()
    } else {
        servers.iter().collect()
    };

    if servers_to_check.is_empty() {
        if let Some(server) = server_name {
            return Err(format!("Server '{server}' not found"));
        }
    }

    // Iterate through servers and find the one that contains the tool
    for (srv_name, service) in servers_to_check.iter() {
        let tools = match service.list_all_tools().await {
            Ok(tools) => tools,
            Err(_) => continue, // Skip this server if we can't list tools
        };

        if !tools.iter().any(|t| t.name == tool_name) {
            continue; // Tool not found in this server, try next
        }

        println!("Found tool {tool_name} in server {srv_name}");

        // Call the tool with timeout and cancellation support
        let tool_call = service.call_tool(CallToolRequestParam {
            name: tool_name.clone().into(),
            arguments,
        });

        // Race between timeout, tool call, and cancellation
        let result = if cancellation_token.is_some() {
            tokio::select! {
                result = timeout(timeout_duration, tool_call) => {
                    match result {
                        Ok(call_result) => call_result.map_err(|e| e.to_string()),
                        Err(_) => Err(format!(
                            "Tool call '{tool_name}' timed out after {} seconds",
                            timeout_duration.as_secs()
                        )),
                    }
                }
                _ = cancel_rx => {
                    Err(format!("Tool call '{tool_name}' was cancelled"))
                }
            }
        } else {
            match timeout(timeout_duration, tool_call).await {
                Ok(call_result) => call_result.map_err(|e| e.to_string()),
                Err(_) => Err(format!(
                    "Tool call '{tool_name}' timed out after {} seconds",
                    timeout_duration.as_secs()
                )),
            }
        };

        // Clean up cancellation token
        if let Some(token) = &cancellation_token {
            let mut cancellations = state.tool_call_cancellations.lock().await;
            cancellations.remove(token);
        }

        return result;
    }

    Err(format!("Tool {tool_name} not found"))
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

/// Helper function to check if an error message indicates extension not connected
/// The exact errors from MCP server are:
/// - "Browser extension not connected to bridge"
/// - "Browser extension not responding to ping"
fn is_extension_not_connected_error(text: &str) -> bool {
    const ERROR_PATTERNS: &[&str] = &[
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

    ERROR_PATTERNS
        .iter()
        .any(|pattern| text_lower.contains(pattern))
        || KEYWORD_PAIRS
            .iter()
            .any(|(a, b)| text_lower.contains(a) && text_lower.contains(b))
}

/// Check if the Jan Browser MCP server has its browser extension connected
/// This is done by attempting to call a tool and checking if it fails with
/// "not connected to bridge" error, which indicates the extension is not connected.
///
/// # Arguments
/// * `state` - Application state containing MCP server connections
///
/// # Returns
/// * `Result<bool, String>` - true if extension is connected, false otherwise
#[tauri::command]
pub async fn check_jan_browser_extension_connected(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let servers = state.mcp_servers.lock().await;

    // Check if Jan Browser MCP server is running
    let service = match servers.get("Jan Browser MCP") {
        Some(s) => s,
        None => {
            log::info!("check_jan_browser_extension_connected: server not running");
            return Ok(false);
        }
    };

    log::info!("check_jan_browser_extension_connected: server found, checking tools...");

    // First check if tools are available
    let tools_result = timeout(Duration::from_secs(2), service.list_all_tools()).await;
    let has_tools = match &tools_result {
        Ok(Ok(tools)) => {
            log::info!("check_jan_browser_extension_connected: found {} tools", tools.len());
            !tools.is_empty()
        }
        Ok(Err(e)) => {
            log::info!("check_jan_browser_extension_connected: list_all_tools error: {}", e);
            false
        }
        Err(_) => {
            log::info!("check_jan_browser_extension_connected: list_all_tools timeout");
            false
        }
    };

    if !has_tools {
        log::info!("check_jan_browser_extension_connected: no tools available");
        return Ok(false);
    }

    log::info!("check_jan_browser_extension_connected: calling ping tool to verify connection...");

    // Call the lightweight "ping" tool to check extension connection
    // This returns immediately with "pong" if connected, or error if not connected
    // Much faster than browser_snapshot which captures the accessibility tree
    // Use 3 second timeout - ping should return almost immediately
    let call_result = timeout(
        Duration::from_secs(3),
        service.call_tool(CallToolRequestParam {
            name: "ping".into(),
            arguments: Some(Map::new()),
        }),
    )
    .await;

    match call_result {
        Ok(Ok(result)) => {
            log::info!(
                "ping result: is_error={:?}, content_count={}",
                result.is_error,
                result.content.len()
            );

            // Check if the result indicates extension not connected
            if result.is_error == Some(true) {
                if let Some(content) = result.content.first() {
                    if let Some(text) = content.as_text() {
                        log::info!("ping error response: {}", text.text);
                        if is_extension_not_connected_error(&text.text) {
                            log::info!("Extension not connected: {}", text.text);
                            return Ok(false);
                        }
                    }
                }
            }

            // Check for "pong" response indicating successful connection
            if let Some(content) = result.content.first() {
                if let Some(text) = content.as_text() {
                    log::info!("ping response: {}", text.text);
                    if text.text == "pong" {
                        log::info!("Extension connected - received pong");
                        return Ok(true);
                    }
                    // Check for connection error in text
                    if is_extension_not_connected_error(&text.text) {
                        log::info!("Extension not connected: {}", text.text);
                        return Ok(false);
                    }
                }
            }

            // If we got here with no error, assume connected
            log::info!("Extension check passed - returning connected=true");
            Ok(true)
        }
        Ok(Err(e)) => {
            // Check if the error is about extension not being connected
            let error_str = e.to_string();
            log::info!("ping error: {}", error_str);
            if is_extension_not_connected_error(&error_str) {
                log::info!("Extension not connected (Err): {}", error_str);
                Ok(false)
            } else {
                // Other errors - the tool might not exist in older versions
                // In that case, consider it as not connected to be safe
                log::info!("ping tool error: {}", error_str);
                Ok(false)
            }
        }
        Err(_) => {
            // Timeout - shouldn't happen with ping, but treat as not connected
            log::info!("Extension connection check timed out after 3s");
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn save_mcp_configs<R: Runtime>(app: AppHandle<R>, configs: String) -> Result<(), String> {
    let mut path = get_jan_data_folder_path(app.clone());
    path.push("mcp_config.json");
    log::info!("save mcp configs, path: {path:?}");

    let mut config_value: Value = serde_json::from_str(&configs)
        .map_err(|e| format!("Invalid MCP config payload: {e}"))?;

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
