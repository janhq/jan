use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::Mutex;

use super::{GatewayManager, GatewayConfig, SharedGatewayManager};
use super::server::{http_server, websocket};
use super::types::{GatewayStatus, GatewayResponse, ConnectionState, ThreadMapping, Platform};
use super::platforms;

/// Command to start the gateway server
#[command]
pub async fn gateway_start_server(
    app: AppHandle,
    state: State<'_, SharedGatewayManager>,
    config: GatewayConfig,
) -> Result<GatewayStatus, String> {
    let mut guard = state.lock().await;

    if guard.running {
        return Err("Gateway is already running".to_string());
    }

    // Store the config
    guard.config = Some(config.clone());

    // Clone the Arc for the server functions
    let manager_clone: SharedGatewayManager = (*state).clone();

    // Start HTTP server
    let http_handle = http_server::start_http_server(manager_clone.clone(), config.clone())
        .await
        .map_err(|e| format!("Failed to start HTTP server: {}", e))?;

    guard.http_server = Some(http_handle);

    // Start WebSocket server
    let ws_handle = websocket::start_ws_server(
        manager_clone.clone(),
        "127.0.0.1".to_string(),
        config.ws_port,
    )
    .await
    .map_err(|e| format!("Failed to start WebSocket server: {}", e))?;

    guard.ws_server = Some(ws_handle);
    guard.running = true;

    let status = guard.get_status();

    // Emit status change
    let _ = app.emit("gateway:status", &status);

    // Start message consumer to process queued messages and emit events
    let app_clone = app.clone();

    // Take receiver from queue and spawn consumer
    let mut receiver = match guard.message_queue.take_receiver() {
        Some(r) => r,
        None => {
            log::error!("Failed to take receiver from queue");
            return Err("Failed to initialize message queue".to_string());
        }
    };

    // Spawn message consumer task and store handle
    let consumer_task = tokio::spawn(async move {
        log::info!("[Consumer] Message consumer started");
        let mut msg_count = 0;
        while let Some(msg) = receiver.recv().await {
            msg_count += 1;
            // Emit message event to frontend
            let event_name = format!("gateway:message:{}", msg.platform.as_str());
            let emit_result = app_clone.emit(&event_name, &msg);
            log::info!("[Consumer] #{}. Emitted {} event for message {} (user={}, channel={}, content='{}')",
                msg_count, event_name, msg.id, msg.user_id, msg.channel_id,
                msg.content.chars().take(50).collect::<String>());
            if let Err(e) = emit_result {
                log::error!("[Consumer] Failed to emit {} event: {}", event_name, e);
            } else {
                log::debug!("[Consumer] Event {} emitted successfully", event_name);
            }
        }
        log::info!("[Consumer] Message consumer receiver closed. Total messages processed: {}", msg_count);
    });

    guard.consumer_task = Some(consumer_task);

    Ok(status)
}

/// Command to stop the gateway server
#[command]
pub async fn gateway_stop_server(
    app: AppHandle,
    state: State<'_, SharedGatewayManager>,
) -> Result<(), String> {
    let mut guard = state.lock().await;

    if !guard.running {
        return Err("Gateway is not running".to_string());
    }

    // Stop HTTP server
    if let Some(handle) = guard.http_server.take() {
        handle.request_shutdown();
    }

    // Stop WebSocket server
    if let Some(handle) = guard.ws_server.take() {
        handle.request_shutdown();
    }

    guard.running = false;

    // Cancel consumer task
    if let Some(task) = guard.consumer_task.take() {
        task.abort();
    }

    // Emit status change
    let status = guard.get_status();
    let _ = app.emit("gateway:status", &status);

    Ok(())
}

/// Command to get gateway status
#[command]
pub async fn gateway_get_status(
    state: State<'_, SharedGatewayManager>,
) -> Result<GatewayStatus, String> {
    let guard = state.lock().await;
    Ok(guard.get_status())
}

/// Command to send a response to a messaging platform
#[command]
pub async fn gateway_send_response(
    app: AppHandle,
    state: State<'_, SharedGatewayManager>,
    response: GatewayResponse,
) -> Result<(), String> {
    let platform = response.target_platform.as_str();
    let channel_id = &response.target_channel_id;
    let content_preview = response.content.chars().take(80).collect::<String>();

    log::info!("[Commands] Gateway response to {} on {}: '{}...'",
        platform, channel_id, content_preview);

    // Route to appropriate platform sender
    match platform {
        "discord" => {
            let guard = state.lock().await;
            let sender = guard.discord_sender.clone();
            drop(guard);

            match platforms::discord_sender::send_discord_response(&sender, &response).await {
                Ok(()) => {
                    log::info!("[Commands] Discord response sent successfully");
                    let _ = app.emit("gateway:response:success", &response);
                }
                Err(e) => {
                    log::error!("[Commands] Failed to send Discord response: {}", e);
                    let _ = app.emit("gateway:response:error", serde_json::json!({
                        "response": response,
                        "error": e
                    }));
                    return Err(e);
                }
            }
        }
        "slack" => {
            log::warn!("[Commands] Slack response sending not yet implemented");
            let _ = app.emit("gateway:response", &response);
        }
        "telegram" => {
            log::warn!("[Commands] Telegram response sending not yet implemented");
            let _ = app.emit("gateway:response", &response);
        }
        _ => {
            log::error!("[Commands] Unknown platform: {}", platform);
            return Err(format!("Unknown platform: {}", platform));
        }
    }

    Ok(())
}

/// Command to configure Discord sender
#[command]
pub async fn gateway_configure_discord(
    state: State<'_, SharedGatewayManager>,
    webhook_url: Option<String>,
    bot_token: Option<String>,
) -> Result<(), String> {
    let mut guard = state.lock().await;

    let mut discord_config = platforms::discord_sender::DiscordConfig::default();
    discord_config.webhook_url = webhook_url;
    discord_config.bot_token = bot_token;

    guard.discord_sender.lock().await.configure(discord_config);

    let configured = guard.discord_sender.lock().await.is_configured();
    if configured {
        log::info!("[Commands] Discord sender configured successfully");
    } else {
        log::warn!("[Commands] Discord sender configured but no webhook or bot token provided");
    }

    Ok(())
}

/// Command to get active connections
#[command]
pub async fn gateway_get_connections(
    state: State<'_, SharedGatewayManager>,
) -> Result<Vec<ConnectionState>, String> {
    let guard = state.lock().await;
    // Collect connection states
    let connections: Vec<ConnectionState> = guard.connections.values().cloned().collect();
    Ok(connections)
}

/// Command to validate whitelist configuration
#[command]
pub async fn gateway_validate_whitelist(
    user_ids: Vec<String>,
    channel_ids: Vec<String>,
    guild_ids: Vec<String>,
) -> Result<bool, String> {
    let mut all_ids: Vec<&String> = user_ids.iter().chain(channel_ids.iter()).chain(guild_ids.iter()).collect();
    all_ids.sort();
    all_ids.dedup();

    let is_valid = user_ids.iter().all(|id| !id.contains(' '))
        && channel_ids.iter().all(|id| !id.contains(' '))
        && guild_ids.iter().all(|id| !id.contains(' '));

    Ok(is_valid)
}

/// Command to get thread mappings
#[command]
pub async fn gateway_get_thread_mappings(
    state: State<'_, SharedGatewayManager>,
) -> Result<Vec<ThreadMapping>, String> {
    let guard = state.lock().await;
    // Collect thread mappings from HashMap
    let mappings: Vec<ThreadMapping> = guard.thread_mappings.values().cloned().collect();
    Ok(mappings)
}

/// Command to add a thread mapping
#[command]
pub async fn gateway_add_thread_mapping(
    _app: AppHandle,
    state: State<'_, SharedGatewayManager>,
    platform: String,
    external_id: String,
    jan_thread_id: String,
) -> Result<(), String> {
    let platform_enum = Platform::from_str(&platform);
    if matches!(platform_enum, Platform::Unknown) {
        return Err("Invalid platform".to_string());
    }

    log::info!("[Commands] Adding thread mapping: {}:{} -> {}",
        platform, external_id, jan_thread_id);

    let mut guard = state.lock().await;
    guard.set_thread_mapping(platform_enum, external_id, jan_thread_id.clone());

    log::info!("[Commands] Thread mapping added: {} -> {}", platform, jan_thread_id);

    Ok(())
}

/// Command to remove a thread mapping
#[command]
pub async fn gateway_remove_thread_mapping(
    _app: AppHandle,
    state: State<'_, SharedGatewayManager>,
    platform: String,
    external_id: String,
) -> Result<bool, String> {
    let mut guard = state.lock().await;

    let platform = Platform::from_str(&platform);
    if matches!(platform, Platform::Unknown) {
        return Err("Invalid platform".to_string());
    }

    let existed = guard.thread_mappings.remove(&(platform, external_id)).is_some();
    Ok(existed)
}