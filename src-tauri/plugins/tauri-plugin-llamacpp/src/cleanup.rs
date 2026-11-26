use std::sync::Arc;

use tauri::{Manager, Runtime};

pub async fn cleanup_processes<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    let app_state = match app_handle.try_state::<Arc<crate::state::LlamacppState>>() {
        Some(state) => state,
        None => {
            log::warn!("LlamacppState not found in app_handle");
            return;
        }
    };
    // Unconditional: this is the last-chance path on RunEvent::Exit, so a
    // generation in flight is not a reason to leave the process behind.
    if let Some(watcher) = app_state.unload_watcher.lock().await.take() {
        watcher.abort();
    }
    let maybe_worker = {
        let mut guard = app_state.engine.lock().await;
        guard.take()
    };
    if let Some(worker) = maybe_worker {
        worker.stop().await;
    }

}

#[tauri::command]
pub async fn cleanup_llama_processes<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    cleanup_processes(&app_handle).await;
    Ok(())
}
