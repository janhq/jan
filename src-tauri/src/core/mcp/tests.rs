use super::helpers::{add_server_config, add_server_config_with_path, run_mcp_commands};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::SharedMcpServers;
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
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
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    let result = run_mcp_commands(app.handle(), servers_state).await;

    // Assert that the function returns Ok(())
    assert!(result.is_ok());

    // Clean up the mock config file
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

fn test_add_server_config_new_file() {
    let app = mock_app();
    let app_path = get_jan_data_folder_path(app.handle().clone());
    let config_path = app_path.join("mcp_config_test_new.json");

    // Ensure the directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create parent directory");
    }

    // Create initial config file with empty mcpServers
    let mut file = File::create(&config_path).expect("Failed to create config file");
    file.write_all(b"{\"mcpServers\":{}}")
        .expect("Failed to write to config file");
    drop(file);

    // Test adding a new server config
    let server_value = serde_json::json!({
        "command": "npx",
        "args": ["-y", "test-server"],
        "env": { "TEST_API_KEY": "test_key" },
        "active": false
    });

    let result = add_server_config_with_path(
        app.handle().clone(),
        "test_server".to_string(),
        server_value.clone(),
        Some("mcp_config_test_new.json"),
    );

    assert!(result.is_ok(), "Failed to add server config: {:?}", result);

    // Verify the config was added correctly
    let config_content = std::fs::read_to_string(&config_path)
        .expect("Failed to read config file");
    let config: serde_json::Value = serde_json::from_str(&config_content)
        .expect("Failed to parse config");

    assert!(config["mcpServers"]["test_server"].is_object());
    assert_eq!(config["mcpServers"]["test_server"]["command"], "npx");
    assert_eq!(config["mcpServers"]["test_server"]["args"][0], "-y");
    assert_eq!(config["mcpServers"]["test_server"]["args"][1], "test-server");

    // Clean up
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

#[test]
fn test_add_server_config_existing_servers() {
    let app = mock_app();
    let app_path = get_jan_data_folder_path(app.handle().clone());
    let config_path = app_path.join("mcp_config_test_existing.json");

    // Ensure the directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create parent directory");
    }

    // Create config file with existing server
    let initial_config = serde_json::json!({
        "mcpServers": {
            "existing_server": {
                "command": "existing_command",
                "args": ["arg1"],
                "active": true
            }
        }
    });

    let mut file = File::create(&config_path).expect("Failed to create config file");
    file.write_all(serde_json::to_string_pretty(&initial_config).unwrap().as_bytes())
        .expect("Failed to write to config file");
    drop(file);

    // Add new server
    let new_server_value = serde_json::json!({
        "command": "new_command",
        "args": ["new_arg"],
        "active": false
    });

    let result = add_server_config_with_path(
        app.handle().clone(),
        "new_server".to_string(),
        new_server_value,
        Some("mcp_config_test_existing.json"),
    );

    assert!(result.is_ok(), "Failed to add server config: {:?}", result);

    // Verify both servers exist
    let config_content = std::fs::read_to_string(&config_path)
        .expect("Failed to read config file");
    let config: serde_json::Value = serde_json::from_str(&config_content)
        .expect("Failed to parse config");

    // Check existing server is still there
    assert!(config["mcpServers"]["existing_server"].is_object());
    assert_eq!(config["mcpServers"]["existing_server"]["command"], "existing_command");

    // Check new server was added
    assert!(config["mcpServers"]["new_server"].is_object());
    assert_eq!(config["mcpServers"]["new_server"]["command"], "new_command");

    // Clean up
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

#[test]
fn test_add_server_config_missing_config_file() {
    let app = mock_app();
    let app_path = get_jan_data_folder_path(app.handle().clone());
    let config_path = app_path.join("nonexistent_config.json");

    // Ensure the file doesn't exist
    if config_path.exists() {
        std::fs::remove_file(&config_path).ok();
    }

    let server_value = serde_json::json!({
        "command": "test",
        "args": [],
        "active": false
    });

    let result = add_server_config(
        app.handle().clone(),
        "test".to_string(),
        server_value,
    );

    assert!(result.is_err(), "Expected error when config file doesn't exist");
    assert!(result.unwrap_err().contains("Failed to read config file"));
=======
#[cfg(not(target_os = "windows"))]
#[test]
fn test_bin_path_construction_with_join() {
    // Test that PathBuf::join properly constructs paths
    let bin_path = PathBuf::from("/usr/local/bin");
    let bun_path = bin_path.join("bun");

    assert_eq!(bun_path.to_string_lossy(), "/usr/local/bin/bun");

    // Test conversion to String via display()
    let bun_path_str = bun_path.display().to_string();
    assert_eq!(bun_path_str, "/usr/local/bin/bun");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn test_uv_path_construction_with_join() {
    // Test that PathBuf::join properly constructs paths for uv
    let bin_path = PathBuf::from("/usr/local/bin");
    let uv_path = bin_path.join("uv");

    assert_eq!(uv_path.to_string_lossy(), "/usr/local/bin/uv");

    // Test conversion to String via display()
    let uv_path_str = uv_path.display().to_string();
    assert_eq!(uv_path_str, "/usr/local/bin/uv");
}

#[cfg(target_os = "windows")]
#[test]
fn test_bin_path_construction_windows() {
    // Test Windows-style paths
    let bin_path = PathBuf::from(r"C:\Program Files\bin");
    let bun_path = bin_path.join("bun.exe");

    assert_eq!(bun_path.to_string_lossy(), r"C:\Program Files\bin\bun.exe");

    let bun_path_str = bun_path.display().to_string();
    assert_eq!(bun_path_str, r"C:\Program Files\bin\bun.exe");
}
