use super::commands::is_extension_not_connected_error;
use super::helpers::{add_server_config, add_server_config_with_path, run_mcp_commands};
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
    let config_content = std::fs::read_to_string(&config_path).expect("Failed to read config file");
    let config: serde_json::Value =
        serde_json::from_str(&config_content).expect("Failed to parse config");

    assert!(config["mcpServers"]["test_server"].is_object());
    assert_eq!(config["mcpServers"]["test_server"]["command"], "npx");
    assert_eq!(config["mcpServers"]["test_server"]["args"][0], "-y");
    assert_eq!(
        config["mcpServers"]["test_server"]["args"][1],
        "test-server"
    );

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
    file.write_all(
        serde_json::to_string_pretty(&initial_config)
            .unwrap()
            .as_bytes(),
    )
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
    let config_content = std::fs::read_to_string(&config_path).expect("Failed to read config file");
    let config: serde_json::Value =
        serde_json::from_str(&config_content).expect("Failed to parse config");

    // Check existing server is still there
    assert!(config["mcpServers"]["existing_server"].is_object());
    assert_eq!(
        config["mcpServers"]["existing_server"]["command"],
        "existing_command"
    );

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

    // Ensure the directory exists
    if let Some(parent) = app_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::create_dir_all(&app_path).ok();

    let config_path = app_path.join("mcp_config.json");

    // Ensure the file doesn't exist
    if config_path.exists() {
        std::fs::remove_file(&config_path).ok();
    }

    let server_value = serde_json::json!({
        "command": "test",
        "args": [],
        "active": false
    });

    let result = add_server_config(app.handle().clone(), "test".to_string(), server_value);

    assert!(
        result.is_err(),
        "Expected error when config file doesn't exist"
    );
    assert!(result.unwrap_err().contains("Failed to read config file"));
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
// get_server_summaries Tests
// ============================================================================

#[tokio::test]
async fn test_get_server_summaries_no_connected_servers() {
    use super::commands::get_server_summaries;

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();
    let result = get_server_summaries(state).await;

    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn test_get_server_summaries_with_capabilities_in_active_config() {
    use super::commands::get_server_summaries;
    use crate::core::state::AppState;

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();

    // Inject a pre-connected server name into mcp_servers (empty RunningServiceEnum is not
    // straightforward to create in unit tests, so we test the active_servers path directly)
    {
        let mut active = state.mcp_active_servers.lock().await;
        active.insert(
            "filesystem".to_string(),
            serde_json::json!({
                "command": "npx",
                "args": ["-y", "fs-server"],
                "capabilities": ["filesystem", "files"],
                "description": "Read and write local files"
            }),
        );
    }

    // Summaries are derived from the intersection of connected servers and active config.
    // With no entries in mcp_servers the result should still be empty.
    let result = get_server_summaries(state).await;
    assert!(result.is_ok());
    let summaries = result.unwrap();
    assert!(summaries.is_empty(), "No connected servers → no summaries");
}

#[tokio::test]
async fn test_get_server_summaries_missing_metadata_defaults() {
    use super::commands::get_server_summaries;

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();

    // Active server without capabilities/description fields
    {
        let mut active = state.mcp_active_servers.lock().await;
        active.insert(
            "minimal_server".to_string(),
            serde_json::json!({ "command": "npx", "args": [] }),
        );
    }

    // No entries in mcp_servers → summaries list is empty
    let result = get_server_summaries(state).await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
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
        "pong",                   // Successful ping response
        "Success",                // Generic success
        "Connected successfully", // Connection confirmation
        "",                       // Empty response (not an error)
        "Screenshot captured",    // Successful browser_snapshot
        "Page loaded",            // Browser action success
        "browser",                // Single keyword (not an error pattern)
        "tool",                   // Single keyword (not an error pattern)
    ];

    for msg in connected_responses {
        assert!(
            !is_extension_not_connected_error(msg),
            "Should NOT detect as disconnected: {msg}"
        );
    }
}

// ============================================================================
// constants.rs Tests
// ============================================================================

#[test]
fn test_default_constants_values() {
    use super::constants::*;
    assert_eq!(DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS, 30);
    assert_eq!(DEFAULT_MCP_BASE_RESTART_DELAY_MS, 1000);
    assert_eq!(DEFAULT_MCP_MAX_RESTART_DELAY_MS, 30000);
    assert!((DEFAULT_MCP_BACKOFF_MULTIPLIER - 2.0).abs() < f64::EPSILON);
    assert!(DEFAULT_MCP_BASE_RESTART_DELAY_MS < DEFAULT_MCP_MAX_RESTART_DELAY_MS);
}

#[test]
fn test_default_mcp_config_parses_as_valid_json() {
    use super::constants::DEFAULT_MCP_CONFIG;
    let value: serde_json::Value =
        serde_json::from_str(DEFAULT_MCP_CONFIG).expect("DEFAULT_MCP_CONFIG must be valid JSON");
    assert!(value["mcpServers"].is_object());
    assert!(value["mcpSettings"].is_object());
    // Spot-check known servers
    assert!(value["mcpServers"]["fetch"].is_object());
    assert_eq!(value["mcpServers"]["fetch"]["command"], "uvx");
    assert_eq!(value["mcpServers"]["exa"]["type"], "http");
    assert_eq!(
        value["mcpSettings"]["toolCallTimeoutSeconds"],
        super::constants::DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS
    );
}

#[test]
fn test_default_mcp_config_servers_have_required_fields() {
    use super::constants::DEFAULT_MCP_CONFIG;
    let value: serde_json::Value = serde_json::from_str(DEFAULT_MCP_CONFIG).unwrap();
    let servers = value["mcpServers"].as_object().unwrap();
    for (name, cfg) in servers {
        assert!(cfg.get("command").is_some(), "{name} missing command");
        assert!(cfg.get("args").is_some(), "{name} missing args");
        assert!(
            cfg.get("active").and_then(|v| v.as_bool()).is_some(),
            "{name} missing active bool"
        );
    }
}

// ============================================================================
// models.rs Tests
// ============================================================================

#[test]
fn test_mcp_settings_default_matches_constants() {
    use super::constants;
    use super::models::McpSettings;
    let s = McpSettings::default();
    assert_eq!(
        s.tool_call_timeout_seconds,
        constants::DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS
    );
    assert_eq!(
        s.base_restart_delay_ms,
        constants::DEFAULT_MCP_BASE_RESTART_DELAY_MS
    );
    assert_eq!(
        s.max_restart_delay_ms,
        constants::DEFAULT_MCP_MAX_RESTART_DELAY_MS
    );
    assert!((s.backoff_multiplier - constants::DEFAULT_MCP_BACKOFF_MULTIPLIER).abs() < f64::EPSILON);
    assert!(s.enable_smart_tool_routing);
    assert!(!s.use_lightweight_router_model);
    assert!(s.router_model_provider.is_empty());
    assert!(s.router_model_id.is_empty());
}

#[test]
fn test_mcp_settings_tool_call_timeout_duration_enforces_minimum() {
    use super::models::McpSettings;
    let mut s = McpSettings::default();
    s.tool_call_timeout_seconds = 0;
    assert_eq!(s.tool_call_timeout_duration(), Duration::from_secs(1));
    s.tool_call_timeout_seconds = 5;
    assert_eq!(s.tool_call_timeout_duration(), Duration::from_secs(5));
    s.tool_call_timeout_seconds = 600;
    assert_eq!(s.tool_call_timeout_duration(), Duration::from_secs(600));
}

#[test]
fn test_mcp_settings_deserialize_uses_defaults_for_missing_fields() {
    use super::models::McpSettings;
    let s: McpSettings = serde_json::from_str("{}").unwrap();
    assert_eq!(s, McpSettings::default_for_eq());
}

// helper trait-like for equality (we don't derive PartialEq on the public type)
impl super::models::McpSettings {
    fn default_for_eq() -> Self {
        Self::default()
    }
}

// Compare individual fields since McpSettings doesn't derive PartialEq
impl PartialEq for super::models::McpSettings {
    fn eq(&self, other: &Self) -> bool {
        self.tool_call_timeout_seconds == other.tool_call_timeout_seconds
            && self.base_restart_delay_ms == other.base_restart_delay_ms
            && self.max_restart_delay_ms == other.max_restart_delay_ms
            && (self.backoff_multiplier - other.backoff_multiplier).abs() < f64::EPSILON
            && self.enable_smart_tool_routing == other.enable_smart_tool_routing
            && self.use_lightweight_router_model == other.use_lightweight_router_model
            && self.router_model_provider == other.router_model_provider
            && self.router_model_id == other.router_model_id
    }
}

#[test]
fn test_mcp_settings_round_trip_camel_case() {
    use super::models::McpSettings;
    let mut s = McpSettings::default();
    s.tool_call_timeout_seconds = 42;
    s.router_model_provider = "openai".into();
    s.router_model_id = "gpt-4".into();
    s.use_lightweight_router_model = true;
    let json = serde_json::to_string(&s).unwrap();
    assert!(json.contains("\"toolCallTimeoutSeconds\":42"));
    assert!(json.contains("\"routerModelProvider\":\"openai\""));
    assert!(json.contains("\"useLightweightRouterModel\":true"));
    let parsed: McpSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, s);
}

#[test]
fn test_mcp_settings_partial_deserialize_preserves_provided_values() {
    use super::models::McpSettings;
    let json = r#"{"toolCallTimeoutSeconds": 90, "backoffMultiplier": 3.5}"#;
    let s: McpSettings = serde_json::from_str(json).unwrap();
    assert_eq!(s.tool_call_timeout_seconds, 90);
    assert!((s.backoff_multiplier - 3.5).abs() < f64::EPSILON);
    // Other fields must fall back to defaults
    let d = McpSettings::default();
    assert_eq!(s.base_restart_delay_ms, d.base_restart_delay_ms);
    assert_eq!(s.enable_smart_tool_routing, d.enable_smart_tool_routing);
}

#[test]
fn test_tool_with_server_serialization_uses_input_schema_camel_case() {
    use super::models::ToolWithServer;
    let t = ToolWithServer {
        name: "search".into(),
        description: Some("d".into()),
        input_schema: serde_json::json!({"type": "object"}),
        server: "srv".into(),
    };
    let json = serde_json::to_string(&t).unwrap();
    assert!(json.contains("\"inputSchema\":"));
    assert!(!json.contains("\"input_schema\""));
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["name"], "search");
    assert_eq!(v["server"], "srv");
}

#[test]
fn test_server_summary_round_trip() {
    use super::models::ServerSummary;
    let s = ServerSummary {
        name: "fs".into(),
        capabilities: vec!["filesystem".into(), "files".into()],
        description: "Read files".into(),
    };
    let json = serde_json::to_string(&s).unwrap();
    let parsed: ServerSummary = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.name, "fs");
    assert_eq!(parsed.capabilities, vec!["filesystem", "files"]);
    assert_eq!(parsed.description, "Read files");
}

// ============================================================================
// helpers.rs pure-function tests: extract_command_args / extract_active_status
// ============================================================================

#[test]
fn test_extract_command_args_minimal_config() {
    use super::helpers::extract_command_args;
    let cfg = serde_json::json!({
        "command": "npx",
        "args": ["-y", "server"]
    });
    let parsed = extract_command_args(&cfg).expect("should parse");
    assert_eq!(parsed.command, "npx");
    assert_eq!(parsed.args.len(), 2);
    assert_eq!(parsed.args[0], "-y");
    assert!(parsed.url.is_none());
    assert!(parsed.transport_type.is_none());
    assert!(parsed.timeout.is_none());
    assert!(parsed.envs.is_empty());
    assert!(parsed.headers.is_empty());
}

#[test]
fn test_extract_command_args_full_config() {
    use super::helpers::extract_command_args;
    let cfg = serde_json::json!({
        "command": "",
        "args": [],
        "type": "http",
        "url": "https://mcp.example.com/mcp",
        "timeout": 45,
        "env": {"API_KEY": "abc", "DEBUG": "1"},
        "headers": {"Authorization": "Bearer xyz"}
    });
    let parsed = extract_command_args(&cfg).expect("should parse");
    assert_eq!(parsed.command, "");
    assert_eq!(parsed.transport_type.as_deref(), Some("http"));
    assert_eq!(parsed.url.as_deref(), Some("https://mcp.example.com/mcp"));
    assert_eq!(parsed.timeout, Some(Duration::from_secs(45)));
    assert_eq!(parsed.envs.get("API_KEY").and_then(|v| v.as_str()), Some("abc"));
    assert_eq!(parsed.envs.get("DEBUG").and_then(|v| v.as_str()), Some("1"));
    assert_eq!(
        parsed.headers.get("Authorization").and_then(|v| v.as_str()),
        Some("Bearer xyz")
    );
}

#[test]
fn test_extract_command_args_returns_none_when_required_fields_missing() {
    use super::helpers::extract_command_args;
    // Missing command
    let cfg = serde_json::json!({"args": []});
    assert!(extract_command_args(&cfg).is_none());
    // Missing args
    let cfg = serde_json::json!({"command": "npx"});
    assert!(extract_command_args(&cfg).is_none());
    // Not an object
    let cfg = serde_json::json!(["a", "b"]);
    assert!(extract_command_args(&cfg).is_none());
    // command not a string
    let cfg = serde_json::json!({"command": 123, "args": []});
    assert!(extract_command_args(&cfg).is_none());
    // args not an array
    let cfg = serde_json::json!({"command": "npx", "args": "oops"});
    assert!(extract_command_args(&cfg).is_none());
}

#[test]
fn test_extract_command_args_parses_default_mcp_config_servers() {
    use super::constants::DEFAULT_MCP_CONFIG;
    use super::helpers::extract_command_args;
    let value: serde_json::Value = serde_json::from_str(DEFAULT_MCP_CONFIG).unwrap();
    for (name, cfg) in value["mcpServers"].as_object().unwrap() {
        let parsed = extract_command_args(cfg)
            .unwrap_or_else(|| panic!("default config server '{name}' should parse"));
        // command may be empty for HTTP transports
        if name == "exa" {
            assert_eq!(parsed.transport_type.as_deref(), Some("http"));
            assert!(parsed.url.is_some());
        } else {
            assert!(!parsed.command.is_empty(), "{name} should have a command");
        }
    }
}

#[test]
fn test_extract_active_status_variants() {
    use super::helpers::extract_active_status;
    assert_eq!(
        extract_active_status(&serde_json::json!({"active": true})),
        Some(true)
    );
    assert_eq!(
        extract_active_status(&serde_json::json!({"active": false})),
        Some(false)
    );
    // Missing
    assert_eq!(extract_active_status(&serde_json::json!({})), None);
    // Wrong type
    assert_eq!(
        extract_active_status(&serde_json::json!({"active": "yes"})),
        None
    );
    // Not an object
    assert_eq!(extract_active_status(&serde_json::json!(true)), None);
}

// ============================================================================
// lockfile.rs Tests
// ============================================================================

#[test]
fn test_mcp_lock_file_serde_round_trip() {
    use super::lockfile::McpLockFile;
    let lock = McpLockFile {
        pid: 4242,
        port: 17389,
        server_name: "Jan Browser MCP".to_string(),
        created_at: "2026-01-01T00:00:00+00:00".to_string(),
        hostname: "test-host".to_string(),
    };
    let json = serde_json::to_string_pretty(&lock).unwrap();
    let parsed: McpLockFile = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.pid, 4242);
    assert_eq!(parsed.port, 17389);
    assert_eq!(parsed.server_name, "Jan Browser MCP");
    assert_eq!(parsed.created_at, "2026-01-01T00:00:00+00:00");
    assert_eq!(parsed.hostname, "test-host");
}

#[test]
fn test_mcp_lock_file_rejects_malformed_json() {
    use super::lockfile::McpLockFile;
    assert!(serde_json::from_str::<McpLockFile>("{").is_err());
    // Missing required fields
    assert!(serde_json::from_str::<McpLockFile>(r#"{"pid": 1}"#).is_err());
}

#[test]
fn test_is_process_alive_for_current_process() {
    use super::lockfile::is_process_alive;
    let me = std::process::id();
    assert!(is_process_alive(me), "current process must be alive");
}

#[cfg(unix)]
#[test]
fn test_is_process_alive_for_almost_certainly_dead_pid() {
    use super::lockfile::is_process_alive;
    // PID 0 is the scheduler / not a real signalable process on Linux/macOS
    // and PID 999999 is extremely unlikely to exist
    // (i32::MAX as u32) exceeds Linux pid_max → kernel returns ESRCH/EINVAL
    assert!(!is_process_alive((i32::MAX as u32)));
}

#[test]
fn test_create_read_delete_lock_file_round_trip() {
    use super::lockfile::{create_lock_file, delete_lock_file, read_lock_file};
    let app = mock_app();
    // Use an unusual port to avoid colliding with other tests
    let port: u16 = 53_111;
    // Ensure clean slate
    let _ = delete_lock_file(app.handle(), port);

    create_lock_file(app.handle(), port, "test-server").expect("create_lock_file");
    let lock = read_lock_file(app.handle(), port).expect("read_lock_file");
    assert_eq!(lock.port, port);
    assert_eq!(lock.server_name, "test-server");
    assert_eq!(lock.pid, std::process::id());
    assert!(!lock.created_at.is_empty());
    assert!(!lock.hostname.is_empty());

    delete_lock_file(app.handle(), port).expect("delete_lock_file");
    assert!(read_lock_file(app.handle(), port).is_none());
}

#[test]
fn test_read_lock_file_returns_none_for_missing_port() {
    use super::lockfile::{delete_lock_file, read_lock_file};
    let app = mock_app();
    let port: u16 = 53_112;
    // Make sure it does not exist
    let _ = delete_lock_file(app.handle(), port);
    assert!(read_lock_file(app.handle(), port).is_none());
}

#[test]
fn test_delete_lock_file_is_idempotent_when_missing() {
    use super::lockfile::delete_lock_file;
    let app = mock_app();
    let port: u16 = 53_113;
    // Calling delete on a non-existent file should still return Ok(())
    assert!(delete_lock_file(app.handle(), port).is_ok());
    assert!(delete_lock_file(app.handle(), port).is_ok());
}

#[tokio::test]
async fn test_check_and_cleanup_stale_lock_no_lock_returns_false() {
    use super::lockfile::{check_and_cleanup_stale_lock, delete_lock_file};
    let app = mock_app();
    let port: u16 = 53_114;
    let _ = delete_lock_file(app.handle(), port);
    let cleaned = check_and_cleanup_stale_lock(app.handle(), port).await.unwrap();
    assert!(!cleaned);
}

#[tokio::test]
async fn test_check_and_cleanup_stale_lock_keeps_live_lock() {
    use super::lockfile::{check_and_cleanup_stale_lock, create_lock_file, delete_lock_file, read_lock_file};
    let app = mock_app();
    let port: u16 = 53_115;
    let _ = delete_lock_file(app.handle(), port);
    create_lock_file(app.handle(), port, "live").unwrap();
    // Lock points at the current PID, which is alive → must NOT be removed
    let cleaned = check_and_cleanup_stale_lock(app.handle(), port).await.unwrap();
    assert!(!cleaned);
    assert!(read_lock_file(app.handle(), port).is_some());
    let _ = delete_lock_file(app.handle(), port);
}

#[cfg(unix)]
#[tokio::test]
async fn test_check_and_cleanup_stale_lock_removes_dead_pid_lock() {
    use super::lockfile::{check_and_cleanup_stale_lock, read_lock_file, McpLockFile};
    use tauri::Manager;
    let app = mock_app();
    let port: u16 = 53_116;
    // Use the SAME directory the lockfile module uses
    let app_data_dir = app.handle().path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&app_data_dir).ok();
    let lock_path = app_data_dir.join(format!("mcp_lock_{}.json", port));

    // PID above pid_max guarantees ESRCH/EINVAL on Unix → reported as not alive
    let dead_pid: u32 = (i32::MAX as u32);
    let lock = McpLockFile {
        pid: dead_pid,
        port,
        server_name: "ghost".to_string(),
        created_at: "2020-01-01T00:00:00+00:00".to_string(),
        hostname: "x".to_string(),
    };
    std::fs::write(&lock_path, serde_json::to_string(&lock).unwrap()).unwrap();
    assert!(read_lock_file(app.handle(), port).is_some(), "seed lock readable");

    let cleaned = check_and_cleanup_stale_lock(app.handle(), port)
        .await
        .unwrap();
    assert!(cleaned, "stale lock for dead PID must be cleaned");
    assert!(read_lock_file(app.handle(), port).is_none());
}

#[test]
fn test_cleanup_own_locks_removes_only_current_pid_locks() {
    use super::lockfile::{
        cleanup_own_locks, create_lock_file, delete_lock_file, read_lock_file, McpLockFile,
    };
    use tauri::Manager;
    let app = mock_app();
    let own_port: u16 = 53_117;
    let other_port: u16 = 53_118;
    let _ = delete_lock_file(app.handle(), own_port);
    let _ = delete_lock_file(app.handle(), other_port);

    // Lock owned by us
    create_lock_file(app.handle(), own_port, "ours").unwrap();

    // Lock owned by some other PID — write directly into the SAME dir lockfile uses
    let app_data_dir = app.handle().path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&app_data_dir).ok();
    let other_path = app_data_dir.join(format!("mcp_lock_{}.json", other_port));
    // Pick a PID that is definitely not us (and survives wrap)
    let foreign_pid = if std::process::id() == 1 { 2 } else { 1 };
    let foreign = McpLockFile {
        pid: foreign_pid,
        port: other_port,
        server_name: "theirs".into(),
        created_at: "2020-01-01T00:00:00+00:00".into(),
        hostname: "x".into(),
    };
    std::fs::write(&other_path, serde_json::to_string(&foreign).unwrap()).unwrap();
    assert!(read_lock_file(app.handle(), other_port).is_some());

    cleanup_own_locks(app.handle()).expect("cleanup_own_locks");

    // Our lock removed, foreign lock untouched
    assert!(read_lock_file(app.handle(), own_port).is_none());
    assert!(
        read_lock_file(app.handle(), other_port).is_some(),
        "foreign-PID lock must be preserved"
    );

    // Cleanup
    let _ = std::fs::remove_file(&other_path);
}
