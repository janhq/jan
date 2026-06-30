//! Tauri command surface for the shared agent loop. Lives in-crate (not a
//! separate plugin) because the loop depends on app-owned state
//! (`LlamacppState`, MLX sessions, provider configs, MCP). `agent_run` bridges
//! the loop's Tauri-free `mpsc` event stream onto a `tauri::ipc::Channel` and is
//! cancellable by `run_id` via `agent_cancel`.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::core::agent::events::StreamEvent;
use crate::core::agent::r#loop::{run_orchestration_streamed, OrchestrationArgs};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::AppState;

/// Registry of in-flight agent runs keyed by client-supplied `run_id`, holding a
/// one-shot cancel sender per run. Managed via `app.manage(AgentRuns::default())`.
#[derive(Default)]
pub struct AgentRuns(pub Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>);

fn build_orchestration_args<R: Runtime>(
    app_handle: &AppHandle<R>,
    state: &AppState,
) -> OrchestrationArgs {
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
        Mutex<HashMap<i32, crate::core::server::MlxBackendSession>>,
    > = Arc::new(Mutex::new(HashMap::new()));

    OrchestrationArgs {
        client: reqwest::Client::new(),
        provider_configs: state.provider_configs.clone(),
        llama_state: llama_state_arc,
        mlx_sessions,
        mcp_servers: state.mcp_servers.clone(),
        mcp_settings: state.mcp_settings.clone(),
        jan_data_folder: get_jan_data_folder_path(app_handle.clone())
            .to_string_lossy()
            .into_owned(),
    }
}

/// Run the agent loop for one request, streaming `StreamEvent`s to `on_event`.
/// Resolves when the loop reaches a terminal state (or is cancelled); the
/// terminal `Done`/`Error` is also delivered over the channel.
#[tauri::command]
pub async fn agent_run<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    runs: State<'_, AgentRuns>,
    run_id: String,
    body: serde_json::Value,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let args = build_orchestration_args(&app_handle, &state);

    let (tx, mut rx) = mpsc::unbounded_channel::<StreamEvent>();
    let forward = tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if on_event.send(ev).is_err() {
                break;
            }
        }
    });

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    runs.0.lock().await.insert(run_id.clone(), cancel_tx);

    // Cancellation is a normal terminal state: emit one `cancelled` event and
    // resolve Ok so the invoke promise does not also surface as an error.
    let result = tokio::select! {
        r = run_orchestration_streamed(&tx, &body, &args) => r,
        _ = cancel_rx => {
            let _ = tx.send(StreamEvent::Error {
                code: "cancelled".to_string(),
                message: "Agent run cancelled".to_string(),
            });
            Ok(serde_json::Value::Null)
        }
    };

    drop(tx);
    let _ = forward.await;
    runs.0.lock().await.remove(&run_id);

    result.map(|_| ())
}

/// Cancel an in-flight `agent_run` by `run_id`. No-op if the run already
/// finished or never existed.
#[tauri::command]
pub async fn agent_cancel(runs: State<'_, AgentRuns>, run_id: String) -> Result<(), String> {
    if let Some(cancel_tx) = runs.0.lock().await.remove(&run_id) {
        let _ = cancel_tx.send(());
    }
    Ok(())
}
