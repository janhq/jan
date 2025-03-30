use std::{collections::HashMap, sync::Arc};

use rmcp::{service::RunningService, transport::TokioChildProcess, RoleClient, ServiceExt};
use tokio::{process::Command, sync::Mutex};

pub async fn run_mcp_commands(
    app_path: String,
    servers_state: Arc<Mutex<HashMap<String, RunningService<RoleClient, ()>>>>,
) -> Result<(), String> {
    println!(
        "Load MCP configs from {}",
        app_path.clone() + "/mcp_config.json"
    );
    // let mut client_list = HashMap::new();
    let config_content = match std::fs::read_to_string(app_path.clone() + "/mcp_config.json") {
        Ok(content) => content,
        Err(e) => return Err(format!("Failed to read config file: {}", e)),
    };

    let mcp_servers: serde_json::Value = match serde_json::from_str(&config_content) {
        Ok(v) => v,
        Err(e) => return Err(format!("Failed to parse config: {}", e)),
    };

    if let Some(servers) = mcp_servers.get("mcpServers") {
        println!("MCP Servers: {servers:#?}");
        if let Some(server_map) = servers.as_object() {
            for (name, config) in server_map {
                println!("Server Name: {}", name);
                if let Some(config_obj) = config.as_object() {
                    if let (Some(command), Some(args)) = (
                        config_obj.get("command").and_then(|v| v.as_str()),
                        config_obj.get("args").and_then(|v| v.as_array()),
                    ) {
                        let mut cmd = Command::new(command);
                        for arg in args {
                            if let Some(arg_str) = arg.as_str() {
                                cmd.arg(arg_str);
                            }
                        }

                        let service =
                            ().serve(TokioChildProcess::new(&mut cmd).map_err(|e| e.to_string())?)
                                .await
                                .map_err(|e| e.to_string())?;
                        {
                            let mut servers_map = servers_state.lock().await;
                            servers_map.insert(name.clone(), service);
                        }
                    }
                }
            }
        }
    }

    // Collect servers into a Vec to avoid holding the RwLockReadGuard across await points
    let servers_map = servers_state.lock().await;
    for (_, service) in servers_map.iter() {
        // Initialize
        let _server_info = service.peer_info();
        println!("Connected to server: {_server_info:#?}");
        // List tools
        let _tools = service.list_all_tools().await.map_err(|e| e.to_string())?;

        println!("Tools: {_tools:#?}");
    }
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
