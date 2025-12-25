use super::commands::is_extension_not_connected_error;
use super::helpers::{add_server_config_with_path, run_mcp_commands};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::{AppState, SharedMcpServers};
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{test::mock_app, Manager};
use tokio::sync::Mutex;

#[tokio::test]
async fn test_run_mcp_commands() {
    let app = mock_app();

    // Register AppState so state::<AppState>() calls succeed
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

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
    let result = run_mcp_commands(app.handle(), servers_state).await;

    // Assert that the function returns Ok(())
    assert!(result.is_ok());

    // Clean up the mock config file
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

#[test]
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

    assert!(result.is_ok(), "Failed to add server config: {result:?}");

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

    assert!(result.is_ok(), "Failed to add server config: {result:?}");

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

    // Use unique test file name to avoid conflicts
    let config_path = app_path.join("mcp_config_test_missing.json");

    // Ensure the directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    // Absolutely ensure the file doesn't exist before test
    if config_path.exists() {
        std::fs::remove_file(&config_path).expect("Failed to remove existing test file");
    }

    let server_value = serde_json::json!({
        "command": "test",
        "args": [],
        "active": false
    });

    // Test with custom path to avoid conflicts
    let result = add_server_config_with_path(
        app.handle().clone(),
        "test".to_string(),
        server_value.clone(),
        Some("mcp_config_test_missing.json"),
    );

    // Should succeed with auto-creation
    assert!(result.is_ok(), "Expected success with auto-created config file: {result:?}");

    // Verify the config file was created
    assert!(config_path.exists(), "Config file should have been created");

    // Verify the server was added correctly
    let config_content = std::fs::read_to_string(&config_path)
        .expect("Failed to read config file");
    let config: serde_json::Value = serde_json::from_str(&config_content)
        .expect("Failed to parse config");

    assert!(config["mcpServers"]["test"].is_object());
    assert_eq!(config["mcpServers"]["test"]["command"], "test");
    assert_eq!(config["mcpServers"]["test"]["active"], false);

    // Clean up
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

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

// ============================================================================
// Shutdown Context Tests
// ============================================================================

use super::helpers::ShutdownContext;
use std::time::Duration;

#[test]
fn test_shutdown_context_app_exit_timeouts() {
    let context = ShutdownContext::AppExit;
    assert_eq!(context.per_server_timeout(), Duration::from_millis(500));
    assert_eq!(context.overall_timeout(), Duration::from_millis(1500));
}

#[test]
fn test_shutdown_context_manual_restart_timeouts() {
    let context = ShutdownContext::ManualRestart;
    assert_eq!(context.per_server_timeout(), Duration::from_secs(2));
    assert_eq!(context.overall_timeout(), Duration::from_secs(5));
}

#[test]
fn test_shutdown_context_factory_reset_timeouts() {
    let context = ShutdownContext::FactoryReset;
    assert_eq!(context.per_server_timeout(), Duration::from_secs(5));
    assert_eq!(context.overall_timeout(), Duration::from_secs(10));
}

#[test]
fn test_shutdown_context_overall_greater_than_per_server() {
    for context in [
        ShutdownContext::AppExit,
        ShutdownContext::ManualRestart,
        ShutdownContext::FactoryReset,
    ] {
        assert!(
            context.overall_timeout() > context.per_server_timeout(),
            "Overall timeout should be greater than per-server timeout for {:?}",
            context
        );
    }
}

#[test]
fn test_shutdown_context_is_copy() {
    let context = ShutdownContext::AppExit;
    let copied = context;
    assert!(matches!(context, ShutdownContext::AppExit));
    assert!(matches!(copied, ShutdownContext::AppExit));
}

#[tokio::test]
async fn test_background_cleanup_with_empty_state() {
    use super::helpers::background_cleanup_mcp_servers;

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();
    background_cleanup_mcp_servers(app.handle(), &state).await;

    let servers = state.mcp_servers.lock().await;
    assert!(servers.is_empty());

    let active = state.mcp_active_servers.lock().await;
    assert!(active.is_empty());

}

#[tokio::test]
async fn test_stop_mcp_servers_with_context_empty_servers() {
    use super::helpers::{stop_mcp_servers_with_context, ShutdownContext};

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();
    let result =
        stop_mcp_servers_with_context(app.handle(), &state, ShutdownContext::AppExit).await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn test_stop_mcp_servers_prevents_concurrent_shutdown() {
    use super::helpers::{stop_mcp_servers_with_context, ShutdownContext};

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();

    {
        let mut shutdown_flag = state.mcp_shutdown_in_progress.lock().await;
        *shutdown_flag = true;
    }

    let result =
        stop_mcp_servers_with_context(app.handle(), &state, ShutdownContext::AppExit).await;

    assert!(result.is_ok());

    {
        let shutdown_flag = state.mcp_shutdown_in_progress.lock().await;
        assert!(*shutdown_flag);
    }
}

// ============================================================================
// Extension Connection Error Detection Tests
// ============================================================================

#[test]
fn test_extension_disconnected_error_detection() {
    // Real error messages from Jan Browser MCP server when extension is not connected
    let disconnected_errors = [
        // Direct error messages from MCP server
        "Browser extension not connected to bridge",
        "Browser extension not responding to ping",
        "extension not connected",
        // Error with different casing (case insensitive)
        "BROWSER EXTENSION NOT CONNECTED TO BRIDGE",
        // Tool not found errors (older extension without ping tool)
        "tool ping not found",
        "Tool 'browser_snapshot' not found in available tools",
        // Wrapped error messages
        "Error: Browser extension not connected to bridge. Please retry.",
        "[MCP] extension not connected - check browser",
    ];

    for msg in disconnected_errors {
        assert!(
            is_extension_not_connected_error(msg),
            "Should detect as disconnected: {msg}"
        );
    }
}

#[test]
fn test_extension_connected_response_detection() {
    // Valid responses when extension IS connected - should NOT trigger error detection
    let connected_responses = [
        "pong",                          // Successful ping response
        "Success",                       // Generic success
        "Connected successfully",        // Connection confirmation
        "",                              // Empty response (not an error)
        "Screenshot captured",           // Successful browser_snapshot
        "Page loaded",                   // Browser action success
        "browser",                       // Single keyword (not an error pattern)
        "tool",                          // Single keyword (not an error pattern)
    ];

    for msg in connected_responses {
        assert!(
            !is_extension_not_connected_error(msg),
            "Should NOT detect as disconnected: {msg}"
        );
    }
}
