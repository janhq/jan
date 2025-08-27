use super::helpers::run_mcp_commands;
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::SharedMcpServers;
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::sync::Arc;
use tauri::test::mock_app;
use tokio::sync::Mutex;

#[tokio::test]
async fn test_run_mcp_commands() {
    let app = mock_app();

    // Get the app path where the config should be created
    let app_path = get_jan_data_folder_path(app.handle().clone());
    let config_path = app_path.join("mcp_config.json");

    // Ensure the directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create parent directory");
    }

    // Create a mock mcp_config.json file at the correct location
    let mut file: File = File::create(&config_path).expect("Failed to create config file");
    file.write_all(b"{\"mcpServers\":{}}")
        .expect("Failed to write to config file");

    // Call the run_mcp_commands function
    let servers_state: SharedMcpServers =
        Arc::new(Mutex::new(HashMap::new()));
    let result = run_mcp_commands(app.handle(), servers_state).await;

    // Assert that the function returns Ok(())
    assert!(result.is_ok());

    // Clean up the mock config file
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}
