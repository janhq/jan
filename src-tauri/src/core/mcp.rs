use std::{collections::HashMap, sync::Arc};

use rmcp::{service::RunningService, transport::TokioChildProcess, RoleClient, ServiceExt};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::{process::Command, sync::Mutex};

use super::{cmd::get_jan_data_folder_path, state::AppState};

/// Runs MCP commands by reading configuration from a JSON file and initializing servers
///
/// # Arguments
/// * `app_path` - Path to the application directory containing mcp_config.json
/// * `servers_state` - Shared state containing running MCP services
///
/// # Returns
/// * `Ok(())` if servers were initialized successfully
/// * `Err(String)` if there was an error reading config or starting servers
pub async fn run_mcp_commands(
    app_path: String,
    servers_state: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>,
) -> Result<(), String> {
    log::info!(
        "Load MCP configs from {}",
        app_path.clone() + "/mcp_config.json"
    );
    let config_content = std::fs::read_to_string(app_path.clone() + "/mcp_config.json")
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let mcp_servers: serde_json::Value = serde_json::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    if let Some(server_map) = mcp_servers.get("mcpServers").and_then(Value::as_object) {
        log::info!("MCP Servers: {server_map:#?}");

        for (name, config) in server_map {
            if let Some((command, args, envs)) = extract_command_args(config) {
                let mut cmd = Command::new(command);
                args.iter().filter_map(Value::as_str).for_each(|arg| {
                    cmd.arg(arg);
                });
                envs.iter().for_each(|(k, v)| {
                    if let Some(v_str) = v.as_str() {
                        cmd.env(k, v_str);
                    }
                });

                let service =
                    ().serve(TokioChildProcess::new(&mut cmd).map_err(|e| e.to_string())?)
                        .await
                        .map_err(|e| e.to_string())?;

                servers_state.lock().await.insert(name.clone(), service);
            }
        }
    }

    // Collect servers into a Vec to avoid holding the RwLockReadGuard across await points
    let servers_map = servers_state.lock().await;
    for (_, service) in servers_map.iter() {
        // Initialize
        let _server_info = service.peer_info();
        log::info!("Connected to server: {_server_info:#?}");
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

#[tauri::command]
pub async fn restart_mcp_servers(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_path = get_jan_data_folder_path(app.clone());
    let app_path_str = app_path.to_str().unwrap().to_string();
    let servers = state.mcp_servers.clone();
    // Stop the servers
    stop_mcp_servers(state.mcp_servers.clone()).await?;

    // Restart the servers
    run_mcp_commands(app_path_str, servers).await?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs::File;
    use std::io::Write;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn test_run_mcp_commands() {
        // Create a mock mcp_config.json file
        let config_path = "mcp_config.json";
        let mut file = File::create(config_path).expect("Failed to create config file");
        file.write_all(b"{\"mcpServers\":{}}")
            .expect("Failed to write to config file");

        // Call the run_mcp_commands function
        let app_path = ".".to_string();
        let servers_state: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let result = run_mcp_commands(app_path, servers_state).await;

        // Assert that the function returns Ok(())
        assert!(result.is_ok());

        // Clean up the mock config file
        std::fs::remove_file(config_path).expect("Failed to remove config file");
    }
}
