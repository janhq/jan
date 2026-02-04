//! Discord bot event handler
//!
//! Handles polling Discord channels and forwarding messages that mention the bot.

use std::sync::Arc;
use tokio::sync::mpsc::Sender;
use tokio::sync::Mutex;
use tokio::time::{interval, Duration};

use super::{DiscordBotEvent, DiscordBotConfig, DiscordBotState, DiscordMessage};
use super::client::DiscordClient;

/// Start the Discord bot polling loop
///
/// This function continuously polls Discord for new messages and forwards
/// those that mention the bot to the gateway.
pub async fn start_bot(
    config: DiscordBotConfig,
    gateway_sender: Sender<DiscordBotEvent>,
    state: Arc<Mutex<DiscordBotState>>,
) -> Result<(), String> {
    log::info!("[DiscordBot] Starting bot...");

    let client = DiscordClient::new(config.clone())
        .map_err(|e| format!("Failed to create Discord client: {}", e))?;

    // Get bot user ID for mention detection
    let bot_user_id = config.bot_user_id.clone()
        .ok_or("Bot user ID not configured")?;

    // Get channel ID
    let channel_id = config.channel_id.clone()
        .ok_or("Channel ID not configured")?;

    log::info!("[DiscordBot] Bot user ID: {}", bot_user_id);
    log::info!("[DiscordBot] Target channel: {}", channel_id);

    // Verify bot is in the channel
    let channel = client.get_channel(&channel_id).await
        .map_err(|e| format!("Failed to get channel: {}", e))?;
    log::info!("[DiscordBot] Connected to channel: {}", channel.id);

    // Mark as running
    {
        let mut state_guard = state.lock().await;
        state_guard.running = true;
    }

    // Start polling loop
    let poll_interval = Duration::from_millis(1000); // Poll every 1 second
    let mut interval = interval(poll_interval);

    log::info!("[DiscordBot] Starting message polling loop...");

    loop {
        interval.tick().await;

        // Check if still running
        {
            let state_guard = state.lock().await;
            if !state_guard.running {
                log::info!("[DiscordBot] Stopping bot (disabled)");
                break;
            }
        }

        // Get the last message ID we saw
        let last_message_id = {
            let state_guard = state.lock().await;
            state_guard.last_message_id.clone()
        };

        // Fetch new messages
        match client.get_messages(&channel_id, last_message_id.as_deref()).await {
            Ok(messages) => {
                // Process messages (oldest first, so they're in chronological order)
                for message in messages {
                    // Process the message
                    if let Some(event) = process_message(&message, &bot_user_id, &gateway_sender).await {
                        // Update last seen message ID
                        {
                            let mut state_guard = state.lock().await;
                            state_guard.last_message_id = Some(message.id.clone());
                        }

                        // Forward to gateway
                        if let Err(e) = gateway_sender.send(event).await {
                            log::error!("[DiscordBot] Failed to forward message: {}", e);
                        }
                    }
                }
            }
            Err(e) => {
                log::debug!("[DiscordBot] Failed to get messages: {}", e);
                // Continue polling - temporary errors shouldn't stop the bot
            }
        }
    }

    Ok(())
}

/// Process a Discord message and return an event if it mentions the bot
async fn process_message(
    message: &DiscordMessage,
    bot_user_id: &str,
    _gateway_sender: &Sender<DiscordBotEvent>,
) -> Option<DiscordBotEvent> {
    // Skip messages from the bot itself
    if message.author.id == bot_user_id {
        return None;
    }

    // Check if message mentions the bot
    // Discord mentions can be in format: <@USER_ID> or <@!USER_ID>
    let mention_pattern = format!("<@{}>", bot_user_id);
    let mention_pattern_alt = format!("<@!{}>", bot_user_id);

    if !message.content.contains(&mention_pattern) && !message.content.contains(&mention_pattern_alt) {
        return None;
    }

    // Extract content without bot mentions
    let content = message.content
        .replace(&mention_pattern, "")
        .replace(&mention_pattern_alt, "")
        .trim()
        .to_string();

    if content.is_empty() {
        log::debug!("[DiscordBot] Empty message after removing mentions, ignoring");
        return None;
    }

    // Parse timestamp
    let timestamp = match chrono::DateTime::parse_from_rfc3339(&message.timestamp) {
        Ok(dt) => dt.timestamp_millis() as u64,
        Err(_) => chrono::Utc::now().timestamp_millis() as u64,
    };

    let event = DiscordBotEvent {
        message_id: message.id.clone(),
        user_id: message.author.id.clone(),
        channel_id: message.channel_id.clone(),
        guild_id: message.guild_id.clone(),
        content,
        timestamp,
    };

    log::info!(
        "[DiscordBot] 📩 Message from {} in {}: '{}'",
        message.author.username,
        message.channel_id,
        event.content.chars().take(50).collect::<String>()
    );

    Some(event)
}

/// Stop the Discord bot
pub async fn stop_bot(state: &Arc<Mutex<DiscordBotState>>) {
    let mut state_guard = state.lock().await;
    state_guard.running = false;
    state_guard.last_message_id = None;
    log::info!("[DiscordBot] Bot stopped");
}

/// Check if bot is running
pub async fn is_running(state: &Arc<Mutex<DiscordBotState>>) -> bool {
    state.lock().await.running
}

/// Get the last message ID
pub async fn get_last_message_id(state: &Arc<Mutex<DiscordBotState>>) -> Option<String> {
    state.lock().await.last_message_id.clone()
}