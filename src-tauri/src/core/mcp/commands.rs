use rmcp::model::{CallToolRequestParam, CallToolResult};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::time::timeout;
use tokio::sync::oneshot;

use super::{
    constants::{DEFAULT_MCP_CONFIG, MCP_TOOL_CALL_TIMEOUT},
    helpers::{restart_active_mcp_servers, start_mcp_server_with_restart, stop_mcp_servers},
};
use crate::core::{app::commands::get_jan_data_folder_path, state::AppState};
use crate::core::{
    mcp::models::ToolWithServer,
    state::{RunningServiceEnum, SharedMcpServers},
};
use std::fs;

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
pub async fn deactivate_mcp_server(state: State<'_, AppState>, name: String) -> Result<(), String> {
    log::info!("Deactivating MCP server: {}", name);

    // First, mark server as manually deactivated to prevent restart
    // Remove from active servers list to prevent restart
    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.remove(&name);
        log::info!("Removed MCP server {} from active servers list", name);
    }

    // Mark as not successfully connected to prevent restart logic
    {
        let mut connected = state.mcp_successfully_connected.lock().await;
        connected.insert(name.clone(), false);
        log::info!("Marked MCP server {} as not successfully connected", name);
    }

    // Reset restart count
    {
        let mut counts = state.mcp_restart_counts.lock().await;
        counts.remove(&name);
        log::info!("Reset restart count for MCP server {}", name);
    }

    // Now remove and stop the server
    let servers = state.mcp_servers.clone();
    let mut servers_map = servers.lock().await;

    let service = servers_map
        .remove(&name)
        .ok_or_else(|| format!("Server {} not found", name))?;

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
    log::info!("Server {name} stopped successfully and marked as deactivated.");
    Ok(())
}

#[tauri::command]
pub async fn restart_mcp_servers(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let servers = state.mcp_servers.clone();
    // Stop the servers
    stop_mcp_servers(state.mcp_servers.clone()).await?;

    // Restart only previously active servers (like cortex)
    restart_active_mcp_servers(&app, servers).await?;

    app.emit("mcp-update", "MCP servers updated")
        .map_err(|e| format!("Failed to emit event: {}", e))?;

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
        "MCP server {} restart count reset from {} to 0.",
        server_name,
        old_count
    );
    Ok(())
}

#[tauri::command]
pub async fn get_connected_servers(
    _app: AppHandle,
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
    let servers = state.mcp_servers.lock().await;
    let mut all_tools: Vec<ToolWithServer> = Vec::new();

    for (server_name, service) in servers.iter() {
        // List tools with timeout
        let tools_future = service.list_all_tools();
        let tools = match timeout(MCP_TOOL_CALL_TIMEOUT, tools_future).await {
            Ok(result) => result.map_err(|e| e.to_string())?,
            Err(_) => {
                log::warn!(
                    "Listing tools timed out after {} seconds",
                    MCP_TOOL_CALL_TIMEOUT.as_secs()
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
/// * `arguments` - Optional map of argument names to values
/// * `cancellation_token` - Optional token to allow cancellation from JS side
///
/// # Returns
/// * `Result<CallToolResult, String>` - Result of the tool call if successful, or error message if failed
///
/// This function:
/// 1. Locks the MCP servers mutex to access server connections
/// 2. Searches through all servers for one containing the named tool
/// 3. When found, calls the tool on that server with the provided arguments
/// 4. Supports cancellation via cancellation_token
/// 5. Returns error if no server has the requested tool
#[tauri::command]
pub async fn call_tool(
    state: State<'_, AppState>,
    tool_name: String,
    arguments: Option<Map<String, Value>>,
    cancellation_token: Option<String>,
) -> Result<CallToolResult, String> {
    // Set up cancellation if token is provided
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    
    if let Some(token) = &cancellation_token {
        let mut cancellations = state.tool_call_cancellations.lock().await;
        cancellations.insert(token.clone(), cancel_tx);
    }

    let servers = state.mcp_servers.lock().await;

    // Iterate through servers and find the first one that contains the tool
    for (_, service) in servers.iter() {
        let tools = match service.list_all_tools().await {
            Ok(tools) => tools,
            Err(_) => continue, // Skip this server if we can't list tools
        };

        if !tools.iter().any(|t| t.name == tool_name) {
            continue; // Tool not found in this server, try next
        }

        println!("Found tool {} in server", tool_name);

        // Call the tool with timeout and cancellation support
        let tool_call = service.call_tool(CallToolRequestParam {
            name: tool_name.clone().into(),
            arguments,
        });

        // Race between timeout, tool call, and cancellation
        let result = if cancellation_token.is_some() {
            tokio::select! {
                result = timeout(MCP_TOOL_CALL_TIMEOUT, tool_call) => {
                    match result {
                        Ok(call_result) => call_result.map_err(|e| e.to_string()),
                        Err(_) => Err(format!(
                            "Tool call '{}' timed out after {} seconds",
                            tool_name,
                            MCP_TOOL_CALL_TIMEOUT.as_secs()
                        )),
                    }
                }
                _ = cancel_rx => {
                    Err(format!("Tool call '{}' was cancelled", tool_name))
                }
            }
        } else {
            match timeout(MCP_TOOL_CALL_TIMEOUT, tool_call).await {
                Ok(call_result) => call_result.map_err(|e| e.to_string()),
                Err(_) => Err(format!(
                    "Tool call '{}' timed out after {} seconds",
                    tool_name,
                    MCP_TOOL_CALL_TIMEOUT.as_secs()
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

    Err(format!("Tool {} not found", tool_name))
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
        println!("Tool call with token {} cancelled", cancellation_token);
        Ok(())
    } else {
        Err(format!("Cancellation token {} not found", cancellation_token))
    }
}

#[tauri::command]
pub async fn get_mcp_configs(app: AppHandle) -> Result<String, String> {
    let mut path = get_jan_data_folder_path(app);
    path.push("mcp_config.json");
    log::info!("read mcp configs, path: {:?}", path);

    // Create default empty config if file doesn't exist
    if !path.exists() {
        log::info!("mcp_config.json not found, creating default empty config");
        fs::write(&path, DEFAULT_MCP_CONFIG)
            .map_err(|e| format!("Failed to create default MCP config: {}", e))?;
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_mcp_configs(app: AppHandle, configs: String) -> Result<(), String> {
    let mut path = get_jan_data_folder_path(app);
    path.push("mcp_config.json");
    log::info!("save mcp configs, path: {:?}", path);

    fs::write(path, configs).map_err(|e| e.to_string())
}
