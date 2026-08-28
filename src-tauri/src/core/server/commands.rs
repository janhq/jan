use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::state::LlamacppState;

use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::server::proxy;
use crate::core::state::AppState;

#[derive(serde::Deserialize)]
pub struct StartServerConfig {
    pub host: String,
    pub port: u16,
    pub prefix: String,
    pub api_key: String,
    pub trusted_hosts: Vec<String>,
    pub proxy_timeout: u64,
    pub enable_server_tool_execution: Option<bool>,
}

#[tauri::command]
pub async fn start_server<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    config: StartServerConfig,
) -> Result<u16, String> {
    let StartServerConfig {
        host,
        port,
        prefix,
        api_key,
        trusted_hosts,
        proxy_timeout,
        enable_server_tool_execution,
    } = config;
    let server_handle = state.server_handle.clone();
    let llama_state: State<Arc<LlamacppState>> = app_handle.state();
    let llama_state_arc = llama_state.inner().clone();

    // MLX is macOS-only; elsewhere the session map is permanently empty.
    #[cfg(target_os = "macos")]
    let mlx_sessions = {
        let mlx_state: State<tauri_plugin_mlx::state::MlxState> = app_handle.state();
        mlx_state.mlx_server_process.clone()
    };
    #[cfg(not(target_os = "macos"))]
    let mlx_sessions: Arc<
        tokio::sync::Mutex<std::collections::HashMap<i32, crate::core::server::MlxBackendSession>>,
    > = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));

    let actual_port = proxy::start_server(
        server_handle,
        llama_state_arc,
        mlx_sessions,
        host,
        port,
        prefix,
        api_key,
        vec![trusted_hosts],
        proxy_timeout,
        state.provider_configs.clone(),
        state.model_param_defaults.clone(),
        state.mcp_servers.clone(),
        state.mcp_settings.clone(),
        get_jan_data_folder_path(app_handle.clone())
            .to_string_lossy()
            .into_owned(),
        enable_server_tool_execution.unwrap_or(false),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(actual_port)
}

#[tauri::command]
pub async fn stop_server(state: State<'_, AppState>) -> Result<(), String> {
    let server_handle = state.server_handle.clone();

    proxy::stop_server(server_handle)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let server_handle = state.server_handle.clone();

    Ok(proxy::is_server_running(server_handle).await)
}
