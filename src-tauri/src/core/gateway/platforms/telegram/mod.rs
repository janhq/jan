//! Telegram platform module
//!
//! Provides Telegram integration for the gateway.
//! Supports webhook message receiving and Bot API message sending.

pub mod bot;

pub use bot::{TelegramBotConfig, TelegramBotState, SharedTelegramBotState, create_telegram_bot_state};
pub use bot::{send_message, send_reply, send_to_multiple, send_gateway_response};
pub use bot::{format_to_telegram_html, get_me, TelegramError, TelegramSendResult};

pub use super::telegram_parser::{parse_payload, TelegramUpdate, TelegramMessage};