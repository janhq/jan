use super::process::OpenCodeProcessManager;
use super::types::*;
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use log::info;

/// Shared OpenCode process manager type
pub type SharedOpenCodeManager = Arc<Mutex<OpenCodeProcessManager>>;

/// Spawn a new OpenCode task
///
/// # Arguments
/// * `project_path` - Path to the project directory
/// * `prompt` - The task prompt/instruction
/// * `agent` - Optional agent type (build, plan, explore)
/// * `api_key` - Optional API key for the LLM provider
/// * `provider_id` - Optional provider identifier (e.g., "anthropic", "openai")
/// * `model_id` - Optional model identifier (e.g., "claude-sonnet-4-20250514")
/// * `base_url` - Optional base URL for the provider API
///
/// # Returns
/// * Task ID string on success
#[command]
pub async fn opencode_spawn_task(
    app: AppHandle,
    state: State<'_, SharedOpenCodeManager>,
    task_id: Option<String>,
    project_path: String,
    prompt: String,
    agent: Option<String>,
    api_key: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
    base_url: Option<String>,
) -> Result<String, String> {
    // Use provided task_id or generate a new one
    let task_id = task_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    info!(
        "Creating OpenCode task {} for project: {} (provider: {:?}, model: {:?})",
        task_id, project_path, provider_id, model_id
    );

    // Create event channel
    let (event_tx, mut event_rx) = mpsc::channel::<(TaskId, OpenCodeToJan)>(100);

    // Spawn the task
    {
        let manager = state.lock().await;
        manager
            .spawn_task(
                task_id.clone(),
                project_path.clone(),
                prompt,
                agent,
                api_key,
                provider_id,
                model_id,
                base_url,
                event_tx,
            )
            .await?;
    }

    // Forward events to frontend via Tauri events
    let task_id_clone = task_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        while let Some((tid, msg)) = event_rx.recv().await {
            // Emit task-specific event
            let event_name = format!("opencode:event:{}", tid);
            if let Err(e) = app_clone.emit(&event_name, &msg) {
                log::warn!("Failed to emit event for task {}: {}", tid, e);
            }

            // Emit status updates for specific message types
            match &msg {
                OpenCodeToJan::Ready { .. } => {
                    let _ = app_clone.emit(&format!("opencode:status:{}", tid), "ready");
                }
                OpenCodeToJan::Event { payload, .. } => {
                    if let OpenCodeEvent::SessionStarted { .. } = payload.event {
                        let _ = app_clone.emit(&format!("opencode:status:{}", tid), "running");
                    }
                }
                OpenCodeToJan::PermissionRequest { .. } => {
                    let _ =
                        app_clone.emit(&format!("opencode:status:{}", tid), "waiting_permission");
                }
                OpenCodeToJan::Result { payload, .. } => {
                    let status = match payload.status {
                        ResultStatus::Completed => "completed",
                        ResultStatus::Cancelled => "cancelled",
                        ResultStatus::Error => "error",
                    };
                    let _ = app_clone.emit(&format!("opencode:status:{}", tid), status);
                }
                OpenCodeToJan::Error { .. } => {
                    let _ = app_clone.emit(&format!("opencode:status:{}", tid), "error");
                }
            }
        }

        info!("Event forwarder finished for task {}", task_id_clone);
    });

    Ok(task_id)
}

/// Respond to a permission request
#[command]
pub async fn opencode_respond_permission(
    state: State<'_, SharedOpenCodeManager>,
    task_id: String,
    permission_id: String,
    action: String,
    message: Option<String>,
) -> Result<(), String> {
    info!(
        "Permission response for task {}: {} -> {}",
        task_id, permission_id, action
    );

    let action = match action.as_str() {
        "allow_once" => PermissionAction::AllowOnce,
        "allow_always" => PermissionAction::AllowAlways,
        "deny" => PermissionAction::Deny,
        _ => return Err(format!("Invalid permission action: {}", action)),
    };

    let manager = state.lock().await;
    manager
        .respond_to_permission(&task_id, permission_id, action, message)
        .await
}

/// Cancel a running task
#[command]
pub async fn opencode_cancel_task(
    state: State<'_, SharedOpenCodeManager>,
    task_id: String,
) -> Result<(), String> {
    info!("Cancelling OpenCode task: {}", task_id);

    let manager = state.lock().await;
    manager.cancel_task(&task_id).await
}

/// Send user input to a running task
#[command]
pub async fn opencode_send_input(
    state: State<'_, SharedOpenCodeManager>,
    task_id: String,
    text: String,
) -> Result<(), String> {
    info!("Sending input to task {}: {}", task_id, text);

    let manager = state.lock().await;
    manager.send_input(&task_id, text).await
}

/// Check if a task is still running
#[command]
pub async fn opencode_is_task_running(
    state: State<'_, SharedOpenCodeManager>,
    task_id: String,
) -> Result<bool, String> {
    let manager = state.lock().await;
    Ok(manager.is_task_running(&task_id).await)
}

/// Get the count of running tasks
#[command]
pub async fn opencode_running_task_count(
    state: State<'_, SharedOpenCodeManager>,
) -> Result<usize, String> {
    let manager = state.lock().await;
    Ok(manager.running_task_count().await)
}
