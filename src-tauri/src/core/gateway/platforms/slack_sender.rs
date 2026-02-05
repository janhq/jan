//! Slack response sender module
//!
//! Sends responses from Jan back to Slack channels via the Web API.

use crate::core::gateway::types::GatewayResponse;

/// Slack send result
#[derive(Debug, Clone)]
pub struct SlackSendResult {
    pub channel: String,
    pub ts: String,
    pub ok: bool,
}

/// Slack error types
#[derive(Debug, thiserror::Error)]
pub enum SlackError {
    #[error("Network error: {0}")]
    Network(String),
    #[error("API error: {0}")]
    Api(String),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Configuration error: {0}")]
    Config(String),
    #[error("Rate limited, retry after {0}s")]
    RateLimited(u64),
}

/// Send a message to Slack via Web API
pub async fn send_message(
    bot_token: &str,
    channel: &str,
    text: &str,
    thread_ts: Option<&str>,
) -> Result<SlackSendResult, SlackError> {
    let url = "https://slack.com/api/chat.postMessage";

    let mut body = serde_json::Map::new();
    body.insert("channel".to_string(), serde_json::json!(channel));
    body.insert("text".to_string(), serde_json::json!(text));

    if let Some(ts) = thread_ts {
        body.insert("thread_ts".to_string(), serde_json::json!(ts));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", bot_token))
        .header("Content-Type", "application/json; charset=utf-8")
        .json(&body)
        .send()
        .await
        .map_err(|e| SlackError::Network(e.to_string()))?;

    let status = response.status();

    // Handle rate limiting
    if status.as_u16() == 429 {
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(5);
        return Err(SlackError::RateLimited(retry_after));
    }

    let response_text = response
        .text()
        .await
        .map_err(|e| SlackError::Network(e.to_string()))?;

    let result: serde_json::Value =
        serde_json::from_str(&response_text).map_err(|e| SlackError::Parse(e.to_string()))?;

    let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

    if !ok {
        let error_msg = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(SlackError::Api(error_msg.to_string()));
    }

    let channel_id = result
        .get("channel")
        .and_then(|v| v.as_str())
        .unwrap_or(channel)
        .to_string();
    let ts = result
        .get("ts")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(SlackSendResult {
        channel: channel_id,
        ts,
        ok: true,
    })
}

/// Send a GatewayResponse to Slack
pub async fn send_gateway_response(
    bot_token: &str,
    response: &GatewayResponse,
) -> Result<SlackSendResult, SlackError> {
    if bot_token.is_empty() {
        return Err(SlackError::Config("Slack bot token not configured".to_string()));
    }

    send_message(
        bot_token,
        &response.target_channel_id,
        &response.content,
        response.reply_to.as_deref(),
    )
    .await
}

/// Add a reaction to a message (for ACK)
pub async fn add_reaction(
    bot_token: &str,
    channel: &str,
    timestamp: &str,
    emoji: &str,
) -> Result<(), SlackError> {
    let url = "https://slack.com/api/reactions.add";

    let body = serde_json::json!({
        "channel": channel,
        "timestamp": timestamp,
        "name": emoji,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", bot_token))
        .header("Content-Type", "application/json; charset=utf-8")
        .json(&body)
        .send()
        .await
        .map_err(|e| SlackError::Network(e.to_string()))?;

    let response_text = response
        .text()
        .await
        .map_err(|e| SlackError::Network(e.to_string()))?;

    let result: serde_json::Value =
        serde_json::from_str(&response_text).map_err(|e| SlackError::Parse(e.to_string()))?;

    let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

    if !ok {
        let error_msg = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        // "already_reacted" is not an error
        if error_msg != "already_reacted" {
            return Err(SlackError::Api(error_msg.to_string()));
        }
    }

    Ok(())
}

/// Test Slack bot connection by calling auth.test
pub async fn auth_test(bot_token: &str) -> Result<serde_json::Value, SlackError> {
    let url = "https://slack.com/api/auth.test";

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", bot_token))
        .send()
        .await
        .map_err(|e| SlackError::Network(e.to_string()))?;

    let response_text = response
        .text()
        .await
        .map_err(|e| SlackError::Network(e.to_string()))?;

    let result: serde_json::Value =
        serde_json::from_str(&response_text).map_err(|e| SlackError::Parse(e.to_string()))?;

    let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

    if !ok {
        let error_msg = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(SlackError::Api(error_msg.to_string()));
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slack_send_result() {
        let result = SlackSendResult {
            channel: "C123".to_string(),
            ts: "1234567890.123456".to_string(),
            ok: true,
        };
        assert!(result.ok);
        assert_eq!(result.channel, "C123");
    }
}
