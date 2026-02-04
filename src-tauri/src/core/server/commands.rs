use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::state::LlamacppState;
use tauri_plugin_mlx::state::MlxState;

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
    } = config;
    let server_handle = state.server_handle.clone();
    let llama_state: State<LlamacppState> = app_handle.state();
    let sessions = llama_state.llama_server_process.clone();

    let mlx_state: State<MlxState> = app_handle.state();
    let mlx_sessions = mlx_state.mlx_server_process.clone();

    let actual_port = proxy::start_server(
        server_handle,
        sessions,
        mlx_sessions,
        host,
        port,
        prefix,
        api_key,
        vec![trusted_hosts],
        proxy_timeout,
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
