use std::sync::Arc;
use tauri::{Emitter, Runtime, State};

use crate::{
    agent::{AgentEvent, AgentResponse, ChatMessage},
    manifest::Manifest,
    AgentState,
};

#[tauri::command]
pub async fn agent_run<R: Runtime>(
    app:     tauri::AppHandle<R>,
    state:   State<'_, Arc<AgentState>>,
    message: String,
) -> Result<AgentResponse, String> {
    let history = state.history.lock().await.clone();
    let resp = state.agent.run(&history, &message, &mut |event: AgentEvent| {
        let _ = app.emit("agent:event", &event);
    }).await?;

    let mut h = state.history.lock().await;
    h.push(ChatMessage {
        role:         "user".into(),
        content:      Some(message),
        tool_calls:   None,
        tool_call_id: None,
        name:         None,
    });
    h.push(ChatMessage {
        role:         "assistant".into(),
        content:      Some(resp.content.clone()),
        tool_calls:   None,
        tool_call_id: None,
        name:         None,
    });

    Ok(resp)
}

#[tauri::command]
pub async fn agent_reset<R: Runtime>(
    _app:  tauri::AppHandle<R>,
    state: State<'_, Arc<AgentState>>,
) -> Result<(), String> {
    state.history.lock().await.clear();
    Ok(())
}

#[tauri::command]
pub async fn get_tool_manifest<R: Runtime>(
    _app:  tauri::AppHandle<R>,
    state: State<'_, Arc<AgentState>>,
) -> Result<Manifest, String> {
    Ok((*state.manifest).clone())
}
