use rmcp::model::{CallToolRequestParam, CallToolResult, Tool};
use rmcp::{service::RunningService, RoleClient};
use serde_json::{Map, Value};
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::{sync::Mutex, time::timeout};

use super::{
    constants::{DEFAULT_MCP_CONFIG, MCP_TOOL_CALL_TIMEOUT},
    helpers::{restart_active_mcp_servers, start_mcp_server_with_restart, stop_mcp_servers},
};
use crate::core::{app::commands::get_jan_data_folder_path, state::AppState};
use std::fs;

#[tauri::command]
pub async fn activate_mcp_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
    config: Value,
) -> Result<(), String> {
    let servers: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>> =
        state.mcp_servers.clone();

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

    service.cancel().await.map_err(|e| e.to_string())?;
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

/// Retrieves all available tools from all MCP servers
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
/// 4. Combines all tools into a single vector
/// 5. Returns the combined list of all available tools
#[tauri::command]
pub async fn get_tools(state: State<'_, AppState>) -> Result<Vec<Tool>, String> {
    let servers = state.mcp_servers.lock().await;
    let mut all_tools: Vec<Tool> = Vec::new();

    for (_, service) in servers.iter() {
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
            all_tools.push(tool);
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
///
/// # Returns
/// * `Result<CallToolResult, String>` - Result of the tool call if successful, or error message if failed
///
/// This function:
/// 1. Locks the MCP servers mutex to access server connections
/// 2. Searches through all servers for one containing the named tool
/// 3. When found, calls the tool on that server with the provided arguments
/// 4. Returns error if no server has the requested tool
#[tauri::command]
pub async fn call_tool(
    state: State<'_, AppState>,
    tool_name: String,
    arguments: Option<Map<String, Value>>,
) -> Result<CallToolResult, String> {
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

        // Call the tool with timeout
        let tool_call = service.call_tool(CallToolRequestParam {
            name: tool_name.clone().into(),
            arguments,
        });

        return match timeout(MCP_TOOL_CALL_TIMEOUT, tool_call).await {
            Ok(result) => result.map_err(|e| e.to_string()),
            Err(_) => Err(format!(
                "Tool call '{}' timed out after {} seconds",
                tool_name,
                MCP_TOOL_CALL_TIMEOUT.as_secs()
            )),
        };
    }

    Err(format!("Tool {} not found", tool_name))
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
