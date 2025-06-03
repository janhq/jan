use std::{collections::HashMap, env, fs, path::PathBuf, sync::Arc};

use rmcp::model::{CallToolRequestParam, CallToolResult, Tool};
use rmcp::{service::RunningService, transport::TokioChildProcess, RoleClient, ServiceExt};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::{process::Command, sync::Mutex, time::{sleep, timeout, Duration}};

use super::{cmd::get_jan_data_folder_path, state::AppState, rag::RAGMCPModule, mcp_builtin::MCPBuiltIn};

// TODO: find a way to bundle this into build
const DEFAULT_MCP_CONFIG: &str = r#"{
    "mcpServers": {}
}"#;

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
    log::info!(
        "Load MCP configs from {}",
        app_path_str.clone() + "/mcp_config.json"
    );
    
    // Initialize RAG system with proper Jan data folder before starting MCP modules
    if let Err(e) = crate::core::rag::initialize_rag_system_with_app(app.clone()).await {
        log::warn!("Failed to initialize RAG system with app handle: {}, falling back to default", e);
        // Fallback to default initialization
        if let Err(e2) = crate::core::rag::initialize_rag_system().await {
            log::error!("Failed to initialize RAG system: {}", e2);
        }
    }
    
    // Ensure MCP config exists with default RAG server
    ensure_mcp_config_exists(&app_path).await?;
    
    let config_content = std::fs::read_to_string(app_path_str.clone() + "/mcp_config.json")
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let mcp_servers: serde_json::Value = serde_json::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    if let Some(server_map) = mcp_servers.get("mcpServers").and_then(Value::as_object) {
        log::info!("MCP Servers: {server_map:#?}");

        let exe_path = env::current_exe().expect("Failed to get current exe path");
        let exe_parent_path = exe_path
            .parent()
            .expect("Executable must have a parent directory");
        let bin_path = exe_parent_path.to_path_buf();
        
        for (name, config) in server_map {
            if let Some(false) = extract_active_status(config) {
                log::info!("Server {name} is not active, skipping.");
                continue;
            }
            
            // Start server with retry mechanism
            start_mcp_server_with_retry(
                name.clone(),
                config,
                &bin_path,
                &app_path,
                servers_state.clone(),
            ).await;
        }
    }

    // Wait a moment for servers to initialize
    sleep(Duration::from_millis(2000)).await;

    // Collect servers into a Vec to avoid holding the RwLockReadGuard across await points
    let servers_map = servers_state.lock().await;
    for (server_name, service) in servers_map.iter() {
        // Initialize
        let _server_info = service.peer_info();
        log::info!("Connected to server {}: {_server_info:#?}", server_name);
        // Emit event to the frontend
        let event = format!("mcp-connected");
        let server_info: &rmcp::model::InitializeResult = service.peer_info();
        let name = server_info.server_info.name.clone();
        let version = server_info.server_info.version.clone();
        let payload = serde_json::json!({
            "name": name,
            "version": version,
            "server_name": server_name,
        });
        // service.peer_info().server_info.name
        app.emit(&event, payload)
            .map_err(|e| format!("Failed to emit event: {}", e))?;
        log::info!("Emitted event: {event}");
    }
    Ok(())
}

/// Ensures MCP config exists and creates default with RAG server if not
async fn ensure_mcp_config_exists(app_path: &PathBuf) -> Result<(), String> {
    let config_path = app_path.join("mcp_config.json");
    
    if !config_path.exists() {
        log::info!("Creating default MCP config with RAG server");
        
        // Ensure rag directory exists
        let rag_dir = app_path.join("rag");
        if !rag_dir.exists() {
            fs::create_dir_all(&rag_dir)
                .map_err(|e| format!("Failed to create rag directory: {}", e))?;
        }
        
        // Create lancedb directory
        let lancedb_dir = rag_dir.join("lancedb");
        if !lancedb_dir.exists() {
            fs::create_dir_all(&lancedb_dir)
                .map_err(|e| format!("Failed to create lancedb directory: {}", e))?;
        }
        
        // Create models directory
        let models_dir = rag_dir.join("models");
        if !models_dir.exists() {
            fs::create_dir_all(&models_dir)
                .map_err(|e| format!("Failed to create models directory: {}", e))?;
        }
        
        // Create cache directory
        let cache_dir = rag_dir.join("cache");
        if !cache_dir.exists() {
            fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("Failed to create cache directory: {}", e))?;
        }
        
        fs::write(&config_path, DEFAULT_MCP_CONFIG)
            .map_err(|e| format!("Failed to create default MCP config: {}", e))?;
    }
    
    Ok(())
}

/// Starts an MCP server with retry mechanism and enhanced error handling
async fn start_mcp_server_with_retry(
    name: String,
    config: &Value,
    bin_path: &PathBuf,
    _app_path: &PathBuf,
    servers_state: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>,
) {
    const MAX_RETRIES: u32 = 3;
    const RETRY_DELAY_MS: u64 = 2000;
    
    for attempt in 1..=MAX_RETRIES {
        log::info!("Starting MCP server '{}' (attempt {}/{})", name, attempt, MAX_RETRIES);
        
        if let Some((command, args, envs)) = extract_command_args(config) {
            let mut cmd = Command::new(command.clone());
            
            // Handle special commands
            if command.clone() == "npx" {
                let bun_x_path = format!("{}/bun", bin_path.display());
                cmd = Command::new(bun_x_path);
                cmd.arg("x");
            }

            if command.clone() == "uvx" {
                let bun_x_path = format!("{}/uv", bin_path.display());
                cmd = Command::new(bun_x_path);
                cmd.arg("tool");
                cmd.arg("run");
            }
            

            // Add arguments
            args.iter().filter_map(Value::as_str).for_each(|arg| {
                cmd.arg(arg);
            });
            
            // Add environment variables
            envs.iter().for_each(|(k, v)| {
                if let Some(v_str) = v.as_str() {
                    cmd.env(k, v_str);
                }
            });

            log::info!("Executing command for {}: {:?}", name, cmd);

            match TokioChildProcess::new(cmd) {
                Ok(process) => {
                    match ().serve(process).await {
                        Ok(running_service) => {
                            servers_state
                                .lock()
                                .await
                                .insert(name.clone(), running_service);
                            log::info!("Server '{}' started successfully on attempt {}", name, attempt);
                            return; // Success, exit retry loop
                        }
                        Err(e) => {
                            log::error!("Failed to start server '{}' on attempt {}: {}", name, attempt, e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to create process for server '{}' on attempt {}: {}", name, attempt, e);
                }
            }
        } else {
            log::error!("Invalid configuration for server '{}'", name);
            return; // Don't retry for config errors
        }
        
        if attempt < MAX_RETRIES {
            log::info!("Retrying server '{}' in {}ms...", name, RETRY_DELAY_MS);
            sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
        } else {
            log::error!("Failed to start server '{}' after {} attempts", name, MAX_RETRIES);
        }
    }
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

    // Wait a moment for cleanup
    sleep(Duration::from_millis(1000)).await;

    // Restart the servers
    run_mcp_commands(&app, servers).await?;

    app.emit("mcp-update", "MCP servers updated")
        .map_err(|e| format!("Failed to emit event: {}", e))
}

#[tauri::command]
pub async fn get_mcp_server_status(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    let servers = state.mcp_servers.lock().await;
    let mut status_map = HashMap::new();
    
    for (name, service) in servers.iter() {
        // Check if server is responsive
        match service.list_all_tools().await {
            Ok(_) => {
                status_map.insert(name.clone(), "running".to_string());
            }
            Err(_) => {
                status_map.insert(name.clone(), "error".to_string());
            }
        }
    }
    
    Ok(status_map)
}

#[tauri::command]
pub async fn health_check_mcp_servers(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let servers = state.mcp_servers.clone();
    let servers_map = servers.lock().await;
    
    for (name, service) in servers_map.iter() {
        match service.list_all_tools().await {
            Ok(_) => {
                log::info!("Health check passed for MCP server: {}", name);
                app.emit("mcp-health-check", serde_json::json!({
                    "server": name,
                    "status": "healthy"
                })).map_err(|e| format!("Failed to emit health check event: {}", e))?;
            }
            Err(e) => {
                log::error!("Health check failed for MCP server {}: {}", name, e);
                app.emit("mcp-health-check", serde_json::json!({
                    "server": name,
                    "status": "unhealthy",
                    "error": e.to_string()
                })).map_err(|e| format!("Failed to emit health check event: {}", e))?;
            }
        }
    }
    
    Ok(())
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

/// Retrieves all available tools from all MCP servers and built-in RAG tools
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
/// 3. Gets the list of tools from each server with timeout
/// 4. Adds built-in RAG tools
/// 5. Combines all tools into a single vector
/// 6. Returns the combined list of all available tools
#[tauri::command]
pub async fn get_tools(state: State<'_, AppState>) -> Result<Vec<Tool>, String> {
    let servers = state.mcp_servers.lock().await;
    let mut all_tools: Vec<Tool> = Vec::new();

    // Add tools from external MCP servers
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

    // Add built-in RAG tools
    let rag_module = RAGMCPModule::new();
    if let Ok(rag_tools) = rag_module.get_tools() {
        all_tools.extend(rag_tools);
    }

    Ok(all_tools)
}


/// Calls a tool by name with optional arguments, checking built-in RAG tools first, then MCP servers
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
/// 1. Checks if the tool is a built-in RAG tool and calls it directly
/// 2. If not found, searches through external MCP servers
/// 3. When found, calls the tool on that server with the provided arguments and timeout
/// 4. Returns error if no server has the requested tool
#[tauri::command]
pub async fn call_tool(
    state: State<'_, AppState>,
    tool_name: String,
    arguments: Option<Map<String, Value>>,
) -> Result<CallToolResult, String> {
    // Check if this is a built-in RAG tool
    let mut rag_module = RAGMCPModule::new();
    let rag_prefix = format!("{}_", rag_module.module_name());
    
    if tool_name.starts_with(&rag_prefix) {
        let _ = rag_module.initialize().await; // Initialize if needed
        
        let args_value = arguments.map(Value::Object).unwrap_or(Value::Object(serde_json::Map::new()));
        match rag_module.call_tool(&tool_name, args_value).await {
            Ok(content) => {
                return Ok(CallToolResult {
                    content,
                    is_error: Some(false),
                });
            }
            Err(e) => {
                return Ok(CallToolResult {
                    content: vec![rmcp::model::Content::text(format!("Error: {}", e))],
                    is_error: Some(true),
                });
            }
        }
    }

    // Check external MCP servers
    let servers = state.mcp_servers.lock().await;

    // Iterate through servers and find the first one that contains the tool
    for (_, service) in servers.iter() {
        if let Ok(tools) = service.list_all_tools().await {
            if tools.iter().any(|t| t.name == tool_name) {
                log::info!("Found tool {} in server", tool_name);

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
