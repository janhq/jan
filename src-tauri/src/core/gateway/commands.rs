use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};

use super::SharedGatewayManager;
use super::server::{http_server, websocket};
use super::types::{GatewayStatus, GatewayResponse, ConnectionState, ThreadMapping, GatewayConfig, Platform, GatewayMessage};
use super::platforms;
use super::discord_bot;
use super::channel::ChannelConfig;
use super::processor::debounce::DebounceConfig;
use super::processor::ack::AckConfig;
use super::routing::agent_integration::AgentRoutingConfig;
use super::jan::JanIntegrationService;

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

    // Initialize platform plugins
    guard.init_plugins();

    // Configure Discord sender from config
    if config.discord_webhook_url.is_some() || config.discord_bot_token.is_some() {
        let mut discord_config = platforms::discord_sender::DiscordConfig::default();
        discord_config.webhook_url = config.discord_webhook_url.clone();
        discord_config.bot_token = config.discord_bot_token.clone();
        guard.discord_sender.lock().await.configure(discord_config);
        log::info!("[Commands] Discord sender configured from config");
    }

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
        log::info!("[FLOW-4] [Consumer] 🚀 Message consumer started");
        let mut msg_count = 0;
        while let Some(msg) = receiver.recv().await {
            msg_count += 1;
            log::info!("[FLOW-4] [Consumer] 📩 Received message #{} from queue: {}", msg_count, msg.id);

            // Emit message event to frontend
            let event_name = format!("gateway:message:{}", msg.platform.as_str());
            log::info!("[FLOW-4] [Consumer] 📡 Emitting event '{}' for message {}", event_name, msg.id);

            let emit_result = app_clone.emit(&event_name, &msg);

            log::info!("[FLOW-4] [Consumer] 📤 Event details:");
            log::info!("[FLOW-4] [Consumer]    - platform: {}", msg.platform.as_str());
            log::info!("[FLOW-4] [Consumer]    - message_id: {}", msg.id);
            log::info!("[FLOW-4] [Consumer]    - user_id: {}", msg.user_id);
            log::info!("[FLOW-4] [Consumer]    - channel_id: {}", msg.channel_id);
            log::info!("[FLOW-4] [Consumer]    - content: '{}'", msg.content.chars().take(80).collect::<String>());

            if let Err(e) = emit_result {
                log::error!("[FLOW-4] [Consumer] ❌ Failed to emit {} event: {}", event_name, e);
            } else {
                log::info!("[FLOW-4] [Consumer] ✅ Event {} emitted successfully. Frontend should receive it.", event_name);
            }
        }
        log::info!("[FLOW-4] [Consumer] 🛑 Message consumer receiver closed. Total messages processed: {}", msg_count);
    });

    guard.consumer_task = Some(consumer_task);

    // Auto-register channels from config
    {
        use super::channel::{ChannelConfig as ChanConfig, ConnectionState as ChanState};

        // Register Discord channel if configured (legacy single-token)
        if config.discord_webhook_url.is_some() || config.discord_bot_token.is_some() {
            let chan_config = ChanConfig {
                platform: Platform::Discord,
                account_id: "default".to_string(),
                display_name: "Discord".to_string(),
                enabled: true,
                ..ChanConfig::default()
            };
            guard.channel_manager.add_channel(chan_config).await;
            guard.channel_manager.set_state(&Platform::Discord, "default", ChanState::Connected, None).await;
            log::info!("[Gateway] Registered Discord channel (default)");
        }

        // Register Telegram channel if configured (legacy single-token)
        if config.telegram_bot_token.is_some() {
            let chan_config = ChanConfig {
                platform: Platform::Telegram,
                account_id: "default".to_string(),
                display_name: "Telegram".to_string(),
                enabled: true,
                ..ChanConfig::default()
            };
            guard.channel_manager.add_channel(chan_config).await;
            guard.channel_manager.set_state(&Platform::Telegram, "default", ChanState::Connected, None).await;
            log::info!("[Gateway] Registered Telegram channel (default)");
        }

        // Register Slack channel if configured (legacy single-token)
        if config.slack_bot_token.is_some() {
            let chan_config = ChanConfig {
                platform: Platform::Slack,
                account_id: "default".to_string(),
                display_name: "Slack".to_string(),
                enabled: true,
                ..ChanConfig::default()
            };
            guard.channel_manager.add_channel(chan_config).await;
            guard.channel_manager.set_state(&Platform::Slack, "default", ChanState::Connected, None).await;
            log::info!("[Gateway] Registered Slack channel (default)");
        }

        // Register named accounts from multi-account config
        for (platform_str, accounts) in &config.accounts {
            let platform_enum = Platform::from_str(platform_str);
            if matches!(platform_enum, Platform::Unknown) {
                log::warn!("[Gateway] Skipping unknown platform in accounts: {}", platform_str);
                continue;
            }
            for account in accounts {
                if !account.enabled || !account.is_configured() {
                    log::info!("[Gateway] Skipping disabled/unconfigured account: {}:{}", platform_str, account.id);
                    continue;
                }
                let chan_config = ChanConfig {
                    platform: platform_enum.clone(),
                    account_id: account.id.clone(),
                    display_name: account.name.clone(),
                    enabled: account.enabled,
                    ..ChanConfig::default()
                };
                guard.channel_manager.add_channel(chan_config).await;
                guard.channel_manager.set_state(&platform_enum, &account.id, ChanState::Connected, None).await;
                log::info!("[Gateway] Registered named account: {}:{}", platform_str, account.id);
            }
        }

        let stats = guard.channel_manager.get_stats().await;
        log::info!("[Gateway] Channel manager: {} channels registered, {} connected",
            stats.total_channels, stats.connected_channels);
    }

    Ok(status)
}

/// Command to stop the gateway server with ordered graceful shutdown
#[command]
pub async fn gateway_stop_server(
    app: AppHandle,
    state: State<'_, SharedGatewayManager>,
) -> Result<(), String> {
    let mut guard = state.lock().await;

    if !guard.running {
        return Err("Gateway is not running".to_string());
    }

    log::info!("[Shutdown] Starting ordered shutdown sequence...");

    // Step 1: Stop accepting new WebSocket connections
    log::info!("[Shutdown] Step 1: Stopping WebSocket server (no new connections)");
    if let Some(handle) = guard.ws_server.take() {
        handle.request_shutdown();
    }

    // Step 2: Stop channel monitors (set all channels to Disconnected)
    log::info!("[Shutdown] Step 2: Stopping all channel monitors");
    {
        use super::channel::ConnectionState as ChanState;
        let channels = guard.channel_manager.get_all_channels().await;
        for (config, _) in &channels {
            guard.channel_manager.set_state(
                &config.platform,
                &config.account_id,
                ChanState::Disconnected,
                Some("Gateway shutting down".to_string()),
            ).await;
        }
    }

    // Step 3: Stop Discord bot if running
    log::info!("[Shutdown] Step 3: Stopping Discord bot");
    if let Some(task) = guard.discord_bot_task.take() {
        task.abort();
    }

    // Step 4: Stop ACK typing indicators
    log::info!("[Shutdown] Step 4: Stopping ACK typing indicators");
    guard.ack_handler.stop_all_typing().await;

    // Step 5: Drain message queue (process remaining messages with timeout)
    log::info!("[Shutdown] Step 5: Draining message queue");
    let remaining = guard.message_queue.len();
    if remaining > 0 {
        log::info!("[Shutdown] {} messages remaining in queue, allowing drain...", remaining);
        // Give the consumer a short grace period to process remaining messages
        drop(guard); // Release lock so consumer can process
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        guard = state.lock().await;
    }

    // Step 6: Cancel consumer task
    log::info!("[Shutdown] Step 6: Cancelling consumer task");
    if let Some(task) = guard.consumer_task.take() {
        task.abort();
    }

    // Step 7: Emit shutdown event to frontend
    log::info!("[Shutdown] Step 7: Emitting shutdown event");
    let _ = app.emit("gateway:shutdown", serde_json::json!({
        "reason": "user_requested",
        "timestamp": chrono::Utc::now().timestamp_millis(),
    }));

    // Step 8: Stop HTTP server
    log::info!("[Shutdown] Step 8: Stopping HTTP server");
    if let Some(handle) = guard.http_server.take() {
        handle.request_shutdown();
    }

    // Step 9: Mark gateway as stopped
    guard.running = false;
    log::info!("[Shutdown] Gateway shutdown complete");

    // Emit final status
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
    log::info!("[Commands] 📨 [GATEWAY-RESPONSE] Received gateway_send_response command");
    log::info!("[Commands] 📨 [GATEWAY-RESPONSE] Target platform: {:?}", response.target_platform);
    log::info!("[Commands] 📨 [GATEWAY-RESPONSE] Target channel: {}", response.target_channel_id);
    log::info!("[Commands] 📨 [GATEWAY-RESPONSE] Response content (first 200 chars): {}",
        response.content.chars().take(200).collect::<String>());

    let platform = response.target_platform.as_str();
    let channel_id = &response.target_channel_id;
    let content_preview = response.content.chars().take(80).collect::<String>();

    // Check Discord webhook configuration
    {
        let guard = state.lock().await;
        let discord_config = &guard.discord_sender.lock().await.config;
        log::info!("[Commands] 📨 [GATEWAY-RESPONSE] Discord config:");
        log::info!("[Commands] 📨 [GATEWAY-RESPONSE]   - webhook_url configured: {}",
            discord_config.webhook_url.is_some());
        if let Some(ref webhook) = discord_config.webhook_url {
            // Log webhook URL (masked for security)
            let masked = if webhook.len() > 20 {
                let parts: Vec<&str> = webhook.rsplitn(2, '/').collect();
                if parts.len() >= 2 {
                    format!(".../{}", parts[0])
                } else {
                    webhook.chars().take(10).collect::<String>() + "..."
                }
            } else {
                webhook.clone()
            };
            log::info!("[Commands] 📨 [GATEWAY-RESPONSE]   - webhook URL: {}", masked);
        }
        log::info!("[Commands] 📨 [GATEWAY-RESPONSE]   - bot_token configured: {}",
            discord_config.bot_token.is_some());
    }

    log::info!("[Commands] Gateway response to {} on {}: '{}...'",
        platform, channel_id, content_preview);
    log::info!("[Commands] Full response content length: {} chars", response.content.len());
    log::info!("[Commands] Response preview (full): {}", response.content);

    // Format and chunk the response content for the target platform
    let chunks = super::formatter::format_and_chunk(&response.content, &response.target_platform);
    log::info!("[Commands] Formatted response into {} chunk(s) for {}", chunks.len(), platform);

    // Route to appropriate platform sender
    match platform {
        "discord" => {
            let guard = state.lock().await;
            let sender = guard.discord_sender.clone();
            drop(guard);

            for (i, chunk) in chunks.iter().enumerate() {
                let chunk_response = GatewayResponse {
                    content: chunk.clone(),
                    // Only reply_to on first chunk
                    reply_to: if i == 0 { response.reply_to.clone() } else { None },
                    ..response.clone()
                };

                match platforms::discord_sender::send_discord_response(&sender, &chunk_response).await {
                    Ok(()) => {
                        log::info!("[Commands] Discord chunk {}/{} sent successfully", i + 1, chunks.len());
                    }
                    Err(e) => {
                        log::error!("[Commands] Failed to send Discord response chunk {}: {}", i + 1, e);
                        let _ = app.emit("gateway:response:error", serde_json::json!({
                            "response": response,
                            "error": e
                        }));
                        return Err(e);
                    }
                }
            }
            let _ = app.emit("gateway:response:success", &response);
        }
        "telegram" => {
            let bot_token = {
                let guard = state.lock().await;
                guard.config.as_ref().and_then(|c| c.telegram_bot_token.clone())
            };

            match bot_token {
                Some(token) if !token.is_empty() => {
                    for (i, chunk) in chunks.iter().enumerate() {
                        match platforms::telegram::send_message(
                            &token,
                            &response.target_channel_id,
                            chunk,
                            if i == 0 { response.reply_to.as_deref() } else { None },
                        ).await {
                            Ok(result) => {
                                log::info!("[Commands] Telegram chunk {}/{} sent: msg_id={}",
                                    i + 1, chunks.len(), result.message_id);
                            }
                            Err(e) => {
                                log::error!("[Commands] Failed to send Telegram chunk {}: {}", i + 1, e);
                                let _ = app.emit("gateway:response:error", serde_json::json!({
                                    "response": response,
                                    "error": e.to_string()
                                }));
                                return Err(format!("Telegram send failed: {}", e));
                            }
                        }
                    }
                    let _ = app.emit("gateway:response:success", &response);
                }
                _ => {
                    log::error!("[Commands] Telegram bot token not configured");
                    return Err("Telegram bot token not configured".to_string());
                }
            }
        }
        "slack" => {
            let bot_token = {
                let guard = state.lock().await;
                guard.config.as_ref().and_then(|c| c.slack_bot_token.clone())
            };

            match bot_token {
                Some(token) if !token.is_empty() => {
                    for (i, chunk) in chunks.iter().enumerate() {
                        match platforms::slack_sender::send_message(
                            &token,
                            &response.target_channel_id,
                            chunk,
                            if i == 0 { response.reply_to.as_deref() } else { None },
                        ).await {
                            Ok(result) => {
                                log::info!("[Commands] Slack chunk {}/{} sent: ts={}",
                                    i + 1, chunks.len(), result.ts);
                            }
                            Err(e) => {
                                log::error!("[Commands] Failed to send Slack chunk {}: {}", i + 1, e);
                                let _ = app.emit("gateway:response:error", serde_json::json!({
                                    "response": response,
                                    "error": e.to_string()
                                }));
                                return Err(format!("Slack send failed: {}", e));
                            }
                        }
                    }
                    let _ = app.emit("gateway:response:success", &response);
                }
                _ => {
                    log::error!("[Commands] Slack bot token not configured");
                    return Err("Slack bot token not configured".to_string());
                }
            }
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
    discord_config.webhook_url = webhook_url.clone();
    discord_config.bot_token = bot_token.clone();

    guard.discord_sender.lock().await.configure(discord_config);

    // Also update stored config for persistence
    if let Some(ref mut config) = guard.config {
        config.discord_webhook_url = webhook_url;
        config.discord_bot_token = bot_token;
    }

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

/// Command to replay missed messages - emits all thread mappings and pending configurations
/// so the frontend can reconnect properly
#[command]
pub async fn gateway_replay_state(
    app: AppHandle,
    state: State<'_, SharedGatewayManager>,
) -> Result<(), String> {
    let guard = state.lock().await;

    // Emit status
    let status = guard.get_status();
    let _ = app.emit("gateway:status", &status);

    // Emit all thread mappings
    log::info!("[Commands] Replaying {} thread mappings", guard.thread_mappings.len());
    for ((platform, _), mapping) in &guard.thread_mappings {
        let event_name = format!("gateway:message:{}", platform.as_str());
        log::info!("[Commands] Re-emitting thread mapping for {}", event_name);
    }

    log::info!("[Commands] State replay complete");
    Ok(())
}

/// Command to start the Discord bot for mention detection
#[command]
pub async fn gateway_start_discord_bot(
    app: AppHandle,
    state: State<'_, SharedGatewayManager>,
    bot_token: String,
    bot_user_id: String,
    channel_id: String,
) -> Result<(), String> {
    log::info!("[Commands] 🎮 Starting Discord bot...");

    // Clone values for async tasks
    let bot_user_id_clone = bot_user_id.clone();
    let channel_id_clone = channel_id.clone();
    let app_for_emit = app.clone();

    // Create bot config
    let bot_config = discord_bot::DiscordBotConfig {
        bot_token: Some(bot_token),
        bot_user_id: Some(bot_user_id),
        channel_id: Some(channel_id.clone()),
        active: true,
    };

    // Store config in state
    {
        let mut guard = state.lock().await;
        guard.discord_bot_state.lock().await.configure(bot_config.clone());
    }

    // Create channel for forwarding events
    let (sender, receiver) = tokio::sync::mpsc::channel::<discord_bot::DiscordBotEvent>(100);

    // Get arc references for async tasks
    let state_arc: Arc<SharedGatewayManager> = Arc::from(state.inner().clone());
    let app_arc = Arc::new(app);

    // Start event processor task
    let state_for_processor = state_arc.clone();
    let app_for_processor = app_arc.clone();
    let _processor_task = tokio::spawn(async move {
        discord_bot_event_processor(receiver, state_for_processor, app_for_processor).await;
    });

    // Clone state for the bot
    let bot_state = {
        let guard = state.lock().await;
        guard.discord_bot_state.clone()
    };

    // Start the bot in a background task
    let bot_task = tokio::spawn(async move {
        if let Err(e) = discord_bot::handler::start_bot(bot_config, sender, bot_state).await {
            log::error!("[Commands] Discord bot error: {}", e);
        }
    });

    // Store task handles
    {
        let mut guard = state.lock().await;
        guard.discord_bot_task = Some(bot_task);
    }

    log::info!("[Commands] ✅ Discord bot started successfully");
    let _ = app_for_emit.emit("gateway:discord_bot:started", serde_json::json!({
        "status": "connected",
        "bot_user_id": bot_user_id_clone,
        "channel_id": channel_id_clone,
    }));

    Ok(())
}

/// Command to stop the Discord bot
#[command]
pub async fn gateway_stop_discord_bot(
    app: AppHandle,
    state: State<'_, SharedGatewayManager>,
) -> Result<(), String> {
    log::info!("[Commands] 🛑 Stopping Discord bot...");

    let bot_state = {
        let guard = state.lock().await;
        guard.discord_bot_state.clone()
    };

    // Stop the bot
    discord_bot::handler::stop_bot(&bot_state).await;

    // Cancel the task
    {
        let mut guard = state.lock().await;
        if let Some(task) = guard.discord_bot_task.take() {
            task.abort();
        }
    }

    log::info!("[Commands] ✅ Discord bot stopped");
    let _ = app.emit("gateway:discord_bot:stopped", serde_json::json!({}));

    Ok(())
}

/// Command to get Discord bot status
#[command]
pub async fn gateway_get_discord_bot_status(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    let bot_state = guard.discord_bot_state.lock().await;

    Ok(serde_json::json!({
        "configured": bot_state.config.is_configured(),
        "active": bot_state.config.active,
        "running": bot_state.running,
        "channel_id": bot_state.config.channel_id,
    }))
}

/// Command to initialize the Jan integration service
#[command]
pub async fn gateway_init_jan_integration(
    state: State<'_, SharedGatewayManager>,
) -> Result<(), String> {
    log::info!("[Commands] Initializing Jan integration service...");

    let mut guard = state.lock().await;

    // Create and store the Jan integration service
    let integration = JanIntegrationService::create_shared();
    guard.jan_integration = Some(integration);

    log::info!("[Commands] Jan integration service initialized");

    Ok(())
}

/// Command to get Jan integration status
#[command]
pub async fn gateway_get_jan_integration_status(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;

    if let Some(ref integration) = guard.jan_integration {
        let integration = integration.lock().await;
        let thread_count = integration.thread_count(None);
        let response_count = integration.get_pending_responses().len();

        return Ok(serde_json::json!({
            "initialized": true,
            "thread_count": thread_count,
            "pending_responses": response_count,
        }));
    }

    Ok(serde_json::json!({
        "initialized": false,
        "thread_count": 0,
        "pending_responses": 0,
    }))
}

/// Command to add a thread mapping via the Jan integration service
#[command]
pub async fn gateway_add_thread_mapping_via_integration(
    _app: AppHandle,
    state: State<'_, SharedGatewayManager>,
    platform: String,
    external_id: String,
    thread_id: String,
) -> Result<(), String> {
    let platform_str = platform.clone();
    let platform_enum = Platform::from_str(&platform);
    if matches!(platform_enum, Platform::Unknown) {
        return Err("Invalid platform".to_string());
    }

    log::info!(
        "[Commands] Adding thread mapping via integration: {}:{} -> {}",
        platform_str, external_id, thread_id
    );

    let mut guard = state.lock().await;
    let external_id_clone = external_id.clone();
    let thread_id_clone = thread_id.clone();

    if let Some(ref integration) = guard.jan_integration {
        let mut integration = integration.lock().await;
        integration.add_thread_mapping(platform_enum, external_id, thread_id);
    } else {
        // Fallback to direct mapping in GatewayManager
        guard.set_thread_mapping(platform_enum, external_id_clone.clone(), thread_id_clone.clone());
    }

    log::info!(
        "[Commands] Thread mapping added via integration: {} -> {}",
        external_id_clone, thread_id_clone
    );

    Ok(())
}

/// Process Discord bot events and forward to gateway queue
async fn discord_bot_event_processor(
    mut receiver: tokio::sync::mpsc::Receiver<discord_bot::DiscordBotEvent>,
    state: Arc<SharedGatewayManager>,
    app: Arc<AppHandle>,
) {
    log::info!("[DiscordBotProcessor] Event processor started");

    // Get Jan integration service if available
    let jan_integration = {
        let guard = state.lock().await;
        guard.jan_integration.clone()
    };

    while let Some(event) = receiver.recv().await {
        log::info!(
            "[DiscordBotProcessor] 📩 Received event from user {} in channel {}",
            event.user_id,
            event.channel_id
        );

        // Convert to GatewayMessage
        let message: GatewayMessage = event.into();

        // Queue the message for processing
        {
            let guard = state.lock().await;
            guard.message_queue.send(message.clone()).await;
        }

        // Process via Jan integration service if available
        if let Some(ref integration) = jan_integration {
            let integration = (*integration).lock().await;
            let config = {
                let guard = state.lock().await;
                guard.config.clone()
            };
            let auto_create_threads = config.as_ref().map(|c| c.auto_create_threads).unwrap_or(true);
            let default_assistant_id = config.as_ref().and_then(|c| c.default_assistant_id.as_ref().map(|s| s.as_str()));

            // Note: We can't call process_message here because it needs &mut self
            // and we're holding a read lock on state. The frontend handles the actual
            // Jan integration via events.
            log::debug!(
                "[DiscordBotProcessor] Jan integration available, message {} will be processed by frontend",
                message.id
            );
        }

        // Emit to frontend
        let event_name = format!("gateway:message:discord");
        let _ = (&*app).emit(&event_name, &message);

        log::info!(
            "[DiscordBotProcessor] ✅ Event queued and emitted: {}",
            message.id
        );
    }

    log::info!("[DiscordBotProcessor] Event processor stopped");
}

// ==================== Telegram Commands ====================

use super::platforms::telegram::{TelegramBotConfig, SharedTelegramBotState, create_telegram_bot_state};

/// Command to configure Telegram bot
#[command]
pub async fn gateway_configure_telegram(
    state: State<'_, SharedGatewayManager>,
    bot_token: String,
) -> Result<(), String> {
    log::info!("[Commands] Configuring Telegram bot...");

    let mut guard = state.lock().await;

    // Update Telegram bot state
    {
        let bot_state = guard.telegram_bot_state.lock().await;
        let mut config = bot_state.config.clone();
        config.bot_token = Some(bot_token.clone());
        config.enabled = true;
    }

    // Also update stored config for persistence
    if let Some(ref mut config) = guard.config {
        config.telegram_bot_token = Some(bot_token.clone());
    }

    log::info!("[Commands] Telegram bot configured successfully");

    Ok(())
}

/// Command to test Telegram bot connection
#[command]
pub async fn gateway_test_telegram_connection(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    // Get bot token first (must be in its own block to drop locks)
    let bot_token = {
        let guard = state.lock().await;
        let bot_state = guard.telegram_bot_state.lock().await;

        match &bot_state.config.bot_token {
            Some(token) if !token.is_empty() => token.clone(),
            _ => {
                return Ok(serde_json::json!({
                    "success": false,
                    "error": "Bot token not configured",
                    "username": serde_json::Value::Null,
                }));
            }
        }
    };

    // Test connection by calling getMe
    match super::platforms::telegram::get_me(&bot_token).await {
        Ok(user) => {
            log::info!("[Commands] Telegram bot connected: @{}", user.username.clone().unwrap_or_default());
            Ok(serde_json::json!({
                "success": true,
                "error": serde_json::Value::Null,
                "username": user.username,
                "first_name": user.first_name,
                "bot_id": user.id,
            }))
        }
        Err(e) => {
            log::error!("[Commands] Telegram connection failed: {:?}", e);
            Ok(serde_json::json!({
                "success": false,
                "error": e.to_string(),
                "username": serde_json::Value::Null,
            }))
        }
    }
}

/// Command to get Telegram bot status
#[command]
pub async fn gateway_get_telegram_status(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    let bot_state = guard.telegram_bot_state.lock().await;

    Ok(serde_json::json!({
        "configured": bot_state.config.is_configured(),
        "enabled": bot_state.config.enabled,
        "running": bot_state.running,
        "last_error": bot_state.last_error,
    }))
}

/// Command to send a test message to Telegram
#[command]
pub async fn gateway_send_telegram_test(
    state: State<'_, SharedGatewayManager>,
    chat_id: String,
    message: String,
) -> Result<serde_json::Value, String> {
    // Get bot token first
    let bot_token = {
        let guard = state.lock().await;
        let bot_state = guard.telegram_bot_state.lock().await;

        match &bot_state.config.bot_token {
            Some(token) if !token.is_empty() => token.clone(),
            _ => return Err("Bot token not configured".to_string()),
        }
    };

    // Send test message
    match super::platforms::telegram::send_message(&bot_token, &chat_id, &message, None).await {
        Ok(result) => {
            log::info!("[Commands] Test message sent to {}: {}", chat_id, result.message_id);
            Ok(serde_json::json!({
                "success": true,
                "message_id": result.message_id,
                "chat_id": result.chat_id,
            }))
        }
        Err(e) => {
            log::error!("[Commands] Failed to send test message: {:?}", e);
            Err(format!("Failed to send: {}", e))
        }
    }
}

/// Command to stop Telegram bot
#[command]
pub async fn gateway_stop_telegram(
    state: State<'_, SharedGatewayManager>,
) -> Result<(), String> {
    log::info!("[Commands] Stopping Telegram bot...");

    let mut guard = state.lock().await;
    let mut bot_state = guard.telegram_bot_state.lock().await;

    bot_state.running = false;
    bot_state.last_error = None;

    log::info!("[Commands] Telegram bot stopped");

    Ok(())
}

// ==================== Channel Manager Commands ====================

/// Command to add a channel to the manager
#[command]
pub async fn gateway_add_channel(
    state: State<'_, SharedGatewayManager>,
    platform: String,
    account_id: String,
    display_name: String,
    enabled: bool,
) -> Result<(), String> {
    let platform_enum = Platform::from_str(&platform);
    if matches!(platform_enum, Platform::Unknown) {
        return Err("Invalid platform".to_string());
    }

    let config = ChannelConfig {
        platform: platform_enum,
        account_id: account_id.clone(),
        display_name,
        enabled,
        ..Default::default()
    };

    let guard = state.lock().await;
    guard.add_channel(config).await;

    log::info!("[Commands] Channel added: {} / {}", platform, account_id);
    Ok(())
}

/// Command to get channel statistics
#[command]
pub async fn gateway_get_channel_stats(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    let stats = guard.channel_manager.get_stats().await;

    Ok(serde_json::json!({
        "total_channels": stats.total_channels,
        "connected_channels": stats.connected_channels,
        "failed_channels": stats.failed_channels,
        "total_messages": stats.total_messages,
        "total_reconnections": stats.total_reconnections,
    }))
}

/// Command to get channel state
#[command]
pub async fn gateway_get_channel_state(
    state: State<'_, SharedGatewayManager>,
    platform: String,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let platform_enum = Platform::from_str(&platform);
    let guard = state.lock().await;
    let state = guard.channel_manager.get_state(&platform_enum, &account_id).await;

    match state {
        Some(s) => Ok(serde_json::json!({
            "state": format!("{:?}", s),
        })),
        None => Ok(serde_json::json!({
            "state": null,
        })),
    }
}

/// Command to list all registered channels with their status
#[command]
pub async fn gateway_list_channels(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    let channels = guard.channel_manager.get_all_channels().await;

    let channel_list: Vec<serde_json::Value> = channels
        .iter()
        .map(|(config, conn_state)| {
            serde_json::json!({
                "platform": config.platform.as_str(),
                "account_id": config.account_id,
                "display_name": config.display_name,
                "enabled": config.enabled,
                "state": format!("{:?}", conn_state),
            })
        })
        .collect();

    // Also include plugin registry info
    let plugins: Vec<&str> = guard.plugin_registry.ids();

    Ok(serde_json::json!({
        "channels": channel_list,
        "registered_plugins": plugins,
    }))
}

// ==================== Debouncer Commands ====================

/// Command to configure message debouncing
#[command]
pub async fn gateway_configure_debounce(
    state: State<'_, SharedGatewayManager>,
    enabled: bool,
    window_ms: u64,
    max_messages: usize,
    flush_on_mention: bool,
    flush_on_command: bool,
) -> Result<(), String> {
    let config = DebounceConfig {
        enabled,
        window_ms,
        max_messages,
        flush_on_mention,
        flush_on_command,
    };

    let guard = state.lock().await;
    guard.debouncer.set_config(config).await;

    log::info!("[Commands] Debounce configured: enabled={}, window={}ms", enabled, window_ms);
    Ok(())
}

/// Command to get debounce statistics
#[command]
pub async fn gateway_get_debounce_stats(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    let stats = guard.debouncer.get_stats().await;

    Ok(serde_json::json!({
        "total_received": stats.total_received,
        "total_flushed": stats.total_flushed,
        "batches_created": stats.batches_created,
        "batches_expired": stats.batches_expired,
        "messages_merged": stats.messages_merged,
    }))
}

// ==================== ACK Handler Commands ====================

/// Command to configure ACK handling
#[command]
pub async fn gateway_configure_ack(
    state: State<'_, SharedGatewayManager>,
    enabled: bool,
    show_typing: bool,
    enable_read_receipts: bool,
) -> Result<(), String> {
    let config = AckConfig {
        enabled,
        show_typing,
        enable_read_receipts,
        ..Default::default()
    };

    let guard = state.lock().await;
    guard.ack_handler.set_config(config).await;

    log::info!("[Commands] ACK configured: enabled={}, typing={}", enabled, show_typing);
    Ok(())
}

/// Command to get ACK statistics
#[command]
pub async fn gateway_get_ack_stats(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    let stats = guard.ack_handler.get_stats().await;

    Ok(serde_json::json!({
        "pending_count": stats.pending_count,
        "delivered_count": stats.delivered_count,
        "read_count": stats.read_count,
        "total_completed": stats.total_completed,
    }))
}

// ==================== Agent Routing Commands ====================

/// Command to configure agent routing
#[command]
pub async fn gateway_configure_agent_routing(
    state: State<'_, SharedGatewayManager>,
    enabled: bool,
    default_agent: String,
    fallback_agent: String,
) -> Result<(), String> {
    let config = AgentRoutingConfig {
        enabled,
        default_agent,
        fallback_agent,
        resolver: Default::default(),
        bindings: vec![],
    };

    let guard = state.lock().await;
    guard.agent_routing.initialize(config).await;

    log::info!("[Commands] Agent routing configured: enabled={}", enabled);
    Ok(())
}

/// Command to resolve agent for a message
#[command]
pub async fn gateway_resolve_agent(
    state: State<'_, SharedGatewayManager>,
    platform: String,
    channel_id: String,
    user_id: String,
    guild_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let platform_enum = Platform::from_str(&platform);
    let guard = state.lock().await;

    let result = guard.agent_routing.resolve_from_context(
        platform_enum,
        &channel_id,
        &user_id,
        guild_id.as_deref(),
    ).await;

    match result {
        Some(r) => Ok(serde_json::json!({
            "agent_id": r.agent_id,
            "confidence": r.confidence,
            "is_fallback": r.is_fallback,
        })),
        None => Ok(serde_json::json!({
            "agent_id": null,
        })),
    }
}

/// Command to get routing statistics
#[command]
pub async fn gateway_get_routing_stats(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;
    let enabled = guard.agent_routing.is_enabled().await;

    if !enabled {
        return Ok(serde_json::json!({
            "enabled": false,
        }));
    }

    let stats = guard.agent_routing.get_stats().await;

    Ok(serde_json::json!({
        "enabled": true,
        "total_resolutions": stats.total_resolutions,
        "cache_size": stats.cache_size,
        "binding_count": stats.binding_count,
    }))
}

// ==================== Account Management Commands ====================

/// Command to add a named account for a platform
#[command]
pub async fn gateway_add_account(
    state: State<'_, SharedGatewayManager>,
    platform: String,
    account_id: String,
    name: String,
    token: Option<String>,
    webhook_url: Option<String>,
) -> Result<(), String> {
    let platform_enum = Platform::from_str(&platform);
    if matches!(platform_enum, Platform::Unknown) {
        return Err("Invalid platform".to_string());
    }

    let account = super::types::PlatformAccount {
        id: account_id.clone(),
        name: name.clone(),
        platform: platform_enum.clone(),
        enabled: true,
        token,
        webhook_url,
        settings: serde_json::Value::Null,
    };

    let mut guard = state.lock().await;

    // Add to config
    if let Some(ref mut config) = guard.config {
        config.accounts.entry(platform.clone()).or_default().push(account.clone());
    }

    // Register channel if configured
    if account.is_configured() {
        use super::channel::{ChannelConfig as ChanConfig, ConnectionState as ChanState};
        let chan_config = ChanConfig {
            platform: platform_enum.clone(),
            account_id: account_id.clone(),
            display_name: name,
            enabled: true,
            ..ChanConfig::default()
        };
        guard.channel_manager.add_channel(chan_config).await;
        guard.channel_manager.set_state(&platform_enum, &account_id, ChanState::Connected, None).await;
    }

    log::info!("[Commands] Account added: {}:{}", platform, account_id);
    Ok(())
}

/// Command to remove a named account
#[command]
pub async fn gateway_remove_account(
    state: State<'_, SharedGatewayManager>,
    platform: String,
    account_id: String,
) -> Result<bool, String> {
    let platform_enum = Platform::from_str(&platform);
    if matches!(platform_enum, Platform::Unknown) {
        return Err("Invalid platform".to_string());
    }

    let mut guard = state.lock().await;

    // Remove from config
    let mut removed = false;
    if let Some(ref mut config) = guard.config {
        if let Some(accounts) = config.accounts.get_mut(&platform) {
            let len_before = accounts.len();
            accounts.retain(|a| a.id != account_id);
            removed = accounts.len() < len_before;
        }
    }

    // Remove channel
    guard.channel_manager.remove_channel(&platform_enum, &account_id).await;

    log::info!("[Commands] Account removed: {}:{} (found={})", platform, account_id, removed);
    Ok(removed)
}

/// Command to list all accounts across all platforms
#[command]
pub async fn gateway_list_accounts(
    state: State<'_, SharedGatewayManager>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().await;

    let mut accounts_map = serde_json::Map::new();

    if let Some(ref config) = guard.config {
        // Legacy single-token accounts
        let mut legacy_accounts = Vec::new();
        if config.discord_bot_token.is_some() || config.discord_webhook_url.is_some() {
            legacy_accounts.push(serde_json::json!({
                "platform": "discord",
                "id": "default",
                "name": "Discord (default)",
                "configured": true,
                "source": "legacy",
            }));
        }
        if config.telegram_bot_token.is_some() {
            legacy_accounts.push(serde_json::json!({
                "platform": "telegram",
                "id": "default",
                "name": "Telegram (default)",
                "configured": true,
                "source": "legacy",
            }));
        }
        if config.slack_bot_token.is_some() {
            legacy_accounts.push(serde_json::json!({
                "platform": "slack",
                "id": "default",
                "name": "Slack (default)",
                "configured": true,
                "source": "legacy",
            }));
        }

        // Named accounts
        let mut named_accounts = Vec::new();
        for (platform, accounts) in &config.accounts {
            for account in accounts {
                named_accounts.push(serde_json::json!({
                    "platform": platform,
                    "id": account.id,
                    "name": account.name,
                    "configured": account.is_configured(),
                    "enabled": account.enabled,
                    "source": "named",
                }));
            }
        }

        accounts_map.insert("legacy".to_string(), serde_json::Value::Array(legacy_accounts));
        accounts_map.insert("named".to_string(), serde_json::Value::Array(named_accounts));
    }

    Ok(serde_json::Value::Object(accounts_map))
}