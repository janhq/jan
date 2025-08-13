use tauri::State;

use crate::core::server::proxy;
use crate::core::state::AppState;

#[tauri::command]
pub async fn start_server(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    prefix: String,
    api_key: String,
    trusted_hosts: Vec<String>,
) -> Result<bool, String> {
    let server_handle = state.server_handle.clone();
    let sessions = state.llama_server_process.clone();

    proxy::start_server(
        server_handle,
        sessions,
        host,
        port,
        prefix,
        api_key,
        vec![trusted_hosts],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(true)
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
