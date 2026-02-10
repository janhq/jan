//! Telegram platform module
//!
//! Provides Telegram integration for the gateway.
//! Supports webhook message receiving and Bot API message sending.

pub mod bot;

pub use bot::{SharedTelegramBotState, create_telegram_bot_state};
pub use bot::{send_message, get_me};