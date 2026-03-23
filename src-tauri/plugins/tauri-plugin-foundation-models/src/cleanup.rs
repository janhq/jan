use tauri::{Manager, Runtime};

pub async fn cleanup_processes<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    let app_state = match app_handle.try_state::<crate::state::FoundationModelsState>() {
        Some(state) => state,
        None => {
            log::warn!("FoundationModelsState not found in app_handle");
            return;
        }
    };

    *app_state.loaded.lock().await = false;
    if let Ok(mut tokens) = app_state.cancel_tokens.lock() {
        tokens.clear();
    }
    log::info!("Foundation Models state cleaned up");
}

#[tauri::command]
pub async fn cleanup_foundation_models_processes<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    cleanup_processes(&app_handle).await;
    Ok(())
}
