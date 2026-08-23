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
    // The engine worker first: it is what actually holds the model and the
    // VRAM now. Unconditional -- this is the last-chance path on RunEvent::Exit,
    // so a generation in flight is not a reason to leave the process behind.
    let maybe_worker = {
        let mut guard = app_state.engine.lock().await;
        guard.take()
    };
    if let Some(worker) = maybe_worker {
        worker.stop().await;
    }

    let maybe_handle = {
        let mut guard = app_state.router.lock().await;
        guard.take()
    };
    if let Some(handle) = maybe_handle {
        app_state
            .router_pid
            .store(0, std::sync::atomic::Ordering::SeqCst);
        if let Err(e) = crate::router::stop_router(handle).await {
            log::warn!("Failed to stop router during cleanup: {}", e);
        }
    }
}

#[tauri::command]
pub async fn cleanup_llama_processes<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    cleanup_processes(&app_handle).await;
    Ok(())
}
