//! Platform-specific webhook parsers and senders
//!
//! This module contains parsers and senders for each supported messaging platform:
//! - Discord (parser + sender)
//! - Slack (parser + sender)
//! - Telegram (parser + bot/sender)

pub mod discord;
pub mod discord_sender;
pub mod slack;
pub mod slack_sender;
pub mod telegram_parser;
pub mod telegram;
pub mod plugin;

use super::types::GatewayMessage;

/// Parse a Discord webhook payload into a GatewayMessage
pub fn parse_discord_payload(payload: &serde_json::Value) -> Result<GatewayMessage, String> {
    discord::parse_payload(payload)
}

/// Parse a Slack webhook payload into a GatewayMessage
pub fn parse_slack_payload(payload: &serde_json::Value) -> Result<GatewayMessage, String> {
    slack::parse_payload(payload)
}

/// Parse a Telegram webhook payload into a GatewayMessage
pub fn parse_telegram_payload(payload: &serde_json::Value) -> Result<GatewayMessage, String> {
    telegram_parser::parse_payload(payload)
}