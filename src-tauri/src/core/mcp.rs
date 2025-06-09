use rmcp::model::{CallToolRequestParam, CallToolResult, Tool};
use rmcp::{service::RunningService, transport::TokioChildProcess, RoleClient, ServiceExt};
use serde_json::{Map, Value};
use std::fs;
use std::{collections::HashMap, env, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::{process::Command, sync::Mutex, time::timeout};

use super::{cmd::get_jan_data_folder_path, state::AppState};

const DEFAULT_MCP_CONFIG: &str = r#"{"mcpServers":{"browsermcp":{"command":"npx","args":["@browsermcp/mcp"],"env":{},"active":false},"fetch":{"command":"uvx","args":["mcp-server-fetch"],"env":{},"active":false},"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/path/to/other/allowed/dir"],"env":{},"active":false},"playwright":{"command":"npx","args":["@playwright/mcp","--isolated"],"env":{},"active":false},"sequential-thinking":{"command":"npx","args":["-y","@modelcontextprotocol/server-sequential-thinking"],"env":{},"active":false},"tavily":{"command":"npx","args":["-y","tavily-mcp"],"env":{"TAVILY_API_KEY": "tvly-YOUR_API_KEY-here"},"active":false}}}"#;

// Timeout for MCP tool calls (30 seconds)
const MCP_TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// Runs MCP commands by reading configuration from a JSON file and initializing servers
///
/// # Arguments
/// * `app_path` - Path to the application directory containing mcp_config.json
/// * `servers_state` - Shared state containing running MCP services
///
/// # Returns
/// * `Ok(())` if servers were initialized successfully
/// * `Err(String)` if there was an error reading config or starting servers
pub async fn run_mcp_commands<R: Runtime>(
    app: &AppHandle<R>,
    servers_state: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>,
) -> Result<(), String> {
    let app_path = get_jan_data_folder_path(app.clone());
    let app_path_str = app_path.to_str().unwrap().to_string();
    log::trace!(
        "Load MCP configs from {}",
        app_path_str.clone() + "/mcp_config.json"
    );
    let config_content = std::fs::read_to_string(app_path_str.clone() + "/mcp_config.json")
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let mcp_servers: serde_json::Value = serde_json::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    if let Some(server_map) = mcp_servers.get("mcpServers").and_then(Value::as_object) {
        log::trace!("MCP Servers: {server_map:#?}");

        for (name, config) in server_map {
            if let Some(false) = extract_active_status(config) {
                log::trace!("Server {name} is not active, skipping.");
                continue;
            }
            match start_mcp_server(
                app.clone(),
                servers_state.clone(),
                name.clone(),
                config.clone(),
            )
            .await
            {
                Ok(_) => {
                    log::info!("Server {name} activated successfully.");
                }
                Err(e) => {
                    let _ = app.emit(
                        "mcp-error",
                        format!("Failed to activate MCP server {name}: {e}"),
                    );
                    log::error!("Failed to activate server {name}: {e}");
                    continue; // Skip to the next server
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn activate_mcp_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
    config: Value,
) -> Result<(), String> {
    let servers: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>> =
        state.mcp_servers.clone();
    start_mcp_server(app, servers, name, config).await
}

async fn start_mcp_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    servers: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>,
    name: String,
    config: Value,
) -> Result<(), String> {
    let app_path = get_jan_data_folder_path(app.clone());
    let exe_path = env::current_exe().expect("Failed to get current exe path");
    let exe_parent_path = exe_path
        .parent()
        .expect("Executable must have a parent directory");
    let bin_path = exe_parent_path.to_path_buf();
    if let Some((command, args, envs)) = extract_command_args(&config) {
        let mut cmd = Command::new(command.clone());
        if command.clone() == "npx" {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".npx");
            let bun_x_path = format!("{}/bun", bin_path.display());
            cmd = Command::new(bun_x_path);
            cmd.arg("x");
            cmd.env("BUN_INSTALL", cache_dir.to_str().unwrap().to_string());
        }

        if command.clone() == "uvx" {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".uvx");
            let bun_x_path = format!("{}/uv", bin_path.display());
            cmd = Command::new(bun_x_path);
            cmd.arg("tool");
            cmd.arg("run");
            cmd.env("UV_CACHE_DIR", cache_dir.to_str().unwrap().to_string());
        }
        #[cfg(windows)] {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: prevents shell window on Windows
        }
        let app_path_str = app_path.to_str().unwrap().to_string();
        let log_file_path = format!("{}/logs/app.log", app_path_str);
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_file_path)
        {
            Ok(file) => {
                cmd.stderr(std::process::Stdio::from(file));
            }
            Err(err) => {
                log::error!("Failed to open log file: {}", err);
            }
        };

        cmd.kill_on_drop(true);

        log::trace!("Command: {cmd:#?}");

        args.iter().filter_map(Value::as_str).for_each(|arg| {
            cmd.arg(arg);
        });
        envs.iter().for_each(|(k, v)| {
            if let Some(v_str) = v.as_str() {
                cmd.env(k, v_str);
            }
        });

        let process = TokioChildProcess::new(cmd);
        match process {
            Ok(p) => {
                let service = ().serve(p).await;

                match service {
                    Ok(running_service) => {
                        // Get peer info and clone the needed values before moving the service
                        let (server_name, server_version) = {
                            let server_info = running_service.peer_info();
                            log::trace!("Connected to server: {server_info:#?}");
                            (
                                server_info.server_info.name.clone(),
                                server_info.server_info.version.clone(),
                            )
                        };

                        // Now move the service into the HashMap
                        servers.lock().await.insert(name.clone(), running_service);
                        log::info!("Server {name} started successfully.");

                        // Emit event to the frontend
                        let event = format!("mcp-connected");
                        let payload = serde_json::json!({
                            "name": server_name,
                            "version": server_version,
                        });
                        app.emit(&event, payload)
                            .map_err(|e| format!("Failed to emit event: {}", e))?;
                    }
                    Err(e) => {
                        return Err(format!("Failed to start MCP server {name}: {e}"));
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to run command {name}: {e}");
                return Err(format!("Failed to run command {name}: {e}"));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn deactivate_mcp_server(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let servers = state.mcp_servers.clone();
    let mut servers_map = servers.lock().await;

    if let Some(service) = servers_map.remove(&name) {
        service.cancel().await.map_err(|e| e.to_string())?;
        log::info!("Server {name} stopped successfully.");
    } else {
        return Err(format!("Server {} not found", name));
    }
    Ok(())
}

fn extract_command_args(
    config: &Value,
) -> Option<(String, Vec<Value>, serde_json::Map<String, Value>)> {
    let obj = config.as_object()?;
    let command = obj.get("command")?.as_str()?.to_string();
    let args = obj.get("args")?.as_array()?.clone();
    let envs = obj
        .get("env")
        .unwrap_or(&Value::Object(serde_json::Map::new()))
        .as_object()?
        .clone();
    Some((command, args, envs))
}

fn extract_active_status(config: &Value) -> Option<bool> {
    let obj = config.as_object()?;
    let active = obj.get("active")?.as_bool()?;
    Some(active)
}

#[tauri::command]
pub async fn restart_mcp_servers(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let servers = state.mcp_servers.clone();
    // Stop the servers
    stop_mcp_servers(state.mcp_servers.clone()).await?;

    // Restart the servers
    run_mcp_commands(&app, servers).await?;

    app.emit("mcp-update", "MCP servers updated")
        .map_err(|e| format!("Failed to emit event: {}", e))
}

pub async fn stop_mcp_servers(
    servers_state: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>,
) -> Result<(), String> {
    let mut servers_map = servers_state.lock().await;
    let keys: Vec<String> = servers_map.keys().cloned().collect();
    for key in keys {
        if let Some(service) = servers_map.remove(&key) {
            service.cancel().await.map_err(|e| e.to_string())?;
        }
    }
    drop(servers_map); // Release the lock after stopping
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
        if let Ok(tools) = service.list_all_tools().await {
            if tools.iter().any(|t| t.name == tool_name) {
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
        }
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

    let contents = fs::read_to_string(path).map_err(|e| e.to_string())?;
    return Ok(contents);
}

#[tauri::command]
pub async fn save_mcp_configs(app: AppHandle, configs: String) -> Result<(), String> {
    let mut path = get_jan_data_folder_path(app);
    path.push("mcp_config.json");
    log::info!("save mcp configs, path: {:?}", path);

    fs::write(path, configs).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs::File;
    use std::io::Write;
    use std::sync::Arc;
    use tauri::test::mock_app;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn test_run_mcp_commands() {
        let app = mock_app();
        // Create a mock mcp_config.json file
        let config_path = "mcp_config.json";
        let mut file: File = File::create(config_path).expect("Failed to create config file");
        file.write_all(b"{\"mcpServers\":{}}")
            .expect("Failed to write to config file");

        // Call the run_mcp_commands function
        let servers_state: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let result = run_mcp_commands(app.handle(), servers_state).await;

        // Assert that the function returns Ok(())
        assert!(result.is_ok());

        // Clean up the mock config file
        std::fs::remove_file(config_path).expect("Failed to remove config file");
    }
}
