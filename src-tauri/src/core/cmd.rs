use rmcp::model::{CallToolRequestParam, CallToolResult, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime, State};

use super::{server, setup, state::AppState};

const CONFIGURATION_FILE_NAME: &str = "settings.json";
const DEFAULT_MCP_CONFIG: &str = r#"{
    "mcpServers": {}
}"#;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppConfiguration {
    pub data_folder: String,
    // Add other fields as needed
}
impl AppConfiguration {
    pub fn default() -> Self {
        Self {
            data_folder: String::from("./data"), // Set a default value for the data_folder
                                                 // Add other fields with default values as needed
        }
    }
}

#[tauri::command]
pub fn get_app_configurations<R: Runtime>(app_handle: tauri::AppHandle<R>) -> AppConfiguration {
    let mut app_default_configuration = AppConfiguration::default();

    if std::env::var("CI").unwrap_or_default() == "e2e" {
        return app_default_configuration;
    }

    let configuration_file = get_configuration_file_path(app_handle.clone());

    let default_data_folder = default_data_folder_path(app_handle.clone());

    if !configuration_file.exists() {
        log::info!(
            "App config not found, creating default config at {:?}",
            configuration_file
        );

        app_default_configuration.data_folder = default_data_folder;

        if let Err(err) = fs::write(
            &configuration_file,
            serde_json::to_string(&app_default_configuration).unwrap(),
        ) {
            log::error!("Failed to create default config: {}", err);
        }

        return app_default_configuration;
    }

    match fs::read_to_string(&configuration_file) {
        Ok(content) => match serde_json::from_str::<AppConfiguration>(&content) {
            Ok(app_configurations) => app_configurations,
            Err(err) => {
                log::error!(
                    "Failed to parse app config, returning default config instead. Error: {}",
                    err
                );
                app_default_configuration
            }
        },
        Err(err) => {
            log::error!(
                "Failed to read app config, returning default config instead. Error: {}",
                err
            );
            app_default_configuration
        }
    }
}

#[tauri::command]
pub fn update_app_configuration(
    app_handle: tauri::AppHandle,
    configuration: AppConfiguration,
) -> Result<(), String> {
    let configuration_file = get_configuration_file_path(app_handle);
    log::info!(
        "update_app_configuration, configuration_file: {:?}",
        configuration_file
    );

    fs::write(
        configuration_file,
        serde_json::to_string(&configuration).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_jan_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    if cfg!(test) {
        return PathBuf::from("./data");
    }

    let app_configurations = get_app_configurations(app_handle);
    log::info!("data_folder: {}", app_configurations.data_folder);
    PathBuf::from(app_configurations.data_folder)
}

#[tauri::command]
pub fn get_jan_extensions_path(app_handle: tauri::AppHandle) -> PathBuf {
    get_jan_data_folder_path(app_handle).join("extensions")
}

#[tauri::command]
pub fn get_themes(app_handle: tauri::AppHandle) -> Vec<String> {
    let mut themes = vec![];
    let themes_path = get_jan_data_folder_path(app_handle).join("themes");
    if themes_path.exists() {
        for entry in fs::read_dir(themes_path).unwrap() {
            let entry = entry.unwrap();
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    themes.push(name.to_string());
                }
            }
        }
    }
    themes
}

#[tauri::command]
pub fn read_theme(app_handle: tauri::AppHandle, theme_name: String) -> Result<String, String> {
    let themes_path = get_jan_data_folder_path(app_handle)
        .join("themes")
        .join(theme_name.clone())
        .join("theme.json");
    if themes_path.exists() {
        let content = fs::read_to_string(themes_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err(format!("Theme {} not found", theme_name.clone()))
    }
}

#[tauri::command]
pub fn get_configuration_file_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    let app_path = app_handle.path().app_data_dir().unwrap_or_else(|err| {
        log::error!(
            "Failed to get app data directory: {}. Using home directory instead.",
            err
        );

        let home_dir = std::env::var(if cfg!(target_os = "windows") {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .expect("Failed to determine the home directory");

        PathBuf::from(home_dir)
    });

    let package_name = env!("CARGO_PKG_NAME");
    log::info!("Package name: {}", package_name);
    let old_data_dir = app_path
        .clone()
        .parent()
        .unwrap_or(&app_path.join("../"))
        .join(package_name);
    if old_data_dir.exists() {
        return old_data_dir.join(CONFIGURATION_FILE_NAME);
    } else {
        return app_path.join(CONFIGURATION_FILE_NAME);
    }
}

#[tauri::command]
pub fn default_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> String {
    return app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
}

#[tauri::command]
pub fn relaunch(app: AppHandle) {
    app.restart()
}

#[tauri::command]
pub fn open_app_directory(app: AppHandle) {
    let app_path = app.path().app_data_dir().unwrap();
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(app_path)
            .spawn()
            .expect("Failed to open app directory");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(app_path)
            .spawn()
            .expect("Failed to open app directory");
    } else {
        std::process::Command::new("xdg-open")
            .arg(app_path)
            .spawn()
            .expect("Failed to open app directory");
    }
}

#[tauri::command]
pub fn open_file_explorer(path: String) {
    let path = PathBuf::from(path);
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .expect("Failed to open file explorer");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .expect("Failed to open file explorer");
    } else {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .expect("Failed to open file explorer");
    }
}

#[tauri::command]
pub fn install_extensions(app: AppHandle) {
    if let Err(err) = setup::install_extensions(app, true) {
        log::error!("Failed to install extensions: {}", err);
    }
}

#[tauri::command]
pub fn get_active_extensions(app: AppHandle) -> Vec<serde_json::Value> {
    let mut path = get_jan_extensions_path(app);
    path.push("extensions.json");
    log::info!("get jan extensions, path: {:?}", path);

    let contents = fs::read_to_string(path);
    let contents: Vec<serde_json::Value> = match contents {
        Ok(data) => match serde_json::from_str::<Vec<serde_json::Value>>(&data) {
            Ok(exts) => exts
                .into_iter()
                .map(|ext| {
                    serde_json::json!({
                        "url": ext["url"],
                        "name": ext["name"],
                        "productName": ext["productName"],
                        "active": ext["_active"],
                        "description": ext["description"],
                        "version": ext["version"]
                    })
                })
                .collect(),
            Err(_) => vec![],
        },
        Err(_) => vec![],
    };
    return contents;
}

#[tauri::command]
pub fn get_user_home_path(app: AppHandle) -> String {
    return get_app_configurations(app.clone()).data_folder;
}

#[tauri::command]
pub fn app_token(state: State<'_, AppState>) -> Option<String> {
    state.app_token.clone()
}

#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    host: String,
    port: u16,
    prefix: String,
) -> Result<bool, String> {
    server::start_server(host, port, prefix, app_token(app.state()).unwrap())
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn stop_server() -> Result<(), String> {
    server::stop_server().await.map_err(|e| e.to_string())?;
    Ok(())
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
        // List tools
        let tools = service.list_all_tools().await.map_err(|e| e.to_string())?;

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
                return service
                    .call_tool(CallToolRequestParam {
                        name: tool_name.into(),
                        arguments,
                    })
                    .await
                    .map_err(|e| e.to_string());
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
