//! Discord Bot module for mention detection using Discord REST API
//!
//! This module provides a simple Discord bot that:
//! - Uses Discord's REST API for interactions (no heavy dependencies)
//! - Listens for messages via Discord's HTTP API gateway simulation
//! - Forwards messages that mention the bot to the Gateway
//!
//! Note: For production use, Discord recommends the Gateway WebSocket protocol.
//! This implementation provides a lightweight alternative using REST API calls.

pub mod config;
pub mod client;
pub mod handler;
pub mod idempotency;

pub use self::idempotency::{IdempotencyCache, SharedIdempotencyCache};

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::core::gateway::types::{GatewayMessage, Platform, GATEWAY_PROTOCOL_VERSION};

/// Discord bot configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscordBotConfig {
    pub bot_token: Option<String>,
    pub bot_user_id: Option<String>,
    pub channel_id: Option<String>,
    pub active: bool,
}

impl DiscordBotConfig {
    pub fn is_configured(&self) -> bool {
        self.bot_token.is_some() && self.bot_user_id.is_some()
    }
}

/// State for Discord bot
#[derive(Debug, Default)]
pub struct DiscordBotState {
    pub config: DiscordBotConfig,
    pub running: bool,
    pub last_message_id: Option<String>,
}

impl DiscordBotState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Configure the bot
    pub fn configure(&mut self, config: DiscordBotConfig) {
        self.config = config;
    }

    /// Check if bot is configured
    pub fn is_configured(&self) -> bool {
        self.config.is_configured()
    }
}

/// Shared Discord bot state
pub type SharedDiscordBotState = Arc<Mutex<DiscordBotState>>;

/// Create a new shared Discord bot state
pub fn create_discord_bot_state() -> SharedDiscordBotState {
    Arc::new(Mutex::new(DiscordBotState::new()))
}

/// Discord message event for Gateway processing
#[derive(Debug, Clone)]
pub struct DiscordBotEvent {
    pub message_id: String,
    pub user_id: String,
    pub channel_id: String,
    pub guild_id: Option<String>,
    pub content: String,
    pub timestamp: u64,
}

impl From<DiscordBotEvent> for GatewayMessage {
    fn from(event: DiscordBotEvent) -> Self {
        GatewayMessage {
            id: event.message_id,
            platform: Platform::Discord,
            user_id: event.user_id,
            channel_id: event.channel_id,
            guild_id: event.guild_id,
            content: event.content,
            timestamp: event.timestamp,
            metadata: std::collections::HashMap::new(),
            protocol_version: GATEWAY_PROTOCOL_VERSION.to_string(),
        }
    }
}

/// API response types
#[derive(Debug, Deserialize)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct DiscordMessage {
    pub id: String,
    pub content: String,
    pub channel_id: String,
    pub guild_id: Option<String>,
    pub author: DiscordUser,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct DiscordChannel {
    pub id: String,
    pub last_message_id: Option<String>,
}