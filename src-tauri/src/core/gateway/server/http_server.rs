#![allow(dead_code)]

use hyper::{Body, Request, Response, Server, StatusCode};
use hyper::service::{make_service_fn, service_fn};
use serde_json::json;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;

use super::super::{GatewayManager, SharedGatewayManager, GatewayConfig};
use super::HttpServerHandle;
use crate::core::gateway::types::{GatewayMessage, Platform, GATEWAY_PROTOCOL_VERSION};
use crate::core::gateway::platforms;
use crate::core::gateway::capabilities::{ClientCapabilities, ServerCapabilities, negotiate_capabilities};
use crate::core::gateway::discord_bot::IdempotencyCache;

/// Shared idempotency cache type
type SharedIdempotencyCache = Arc<Mutex<IdempotencyCache>>;

/// Global idempotency cache using OnceLock for safe initialization
static IDEMPOTENCY_CACHE: OnceLock<Mutex<IdempotencyCache>> = OnceLock::new();

pub fn response_json(status: StatusCode, body: serde_json::Value) -> Response<Body> {
    let body_str = body.to_string();
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::from(body_str))
        .unwrap()
}

fn parse_platform_payload(
    platform: Platform,
    raw_payload: &serde_json::Value,
) -> Result<GatewayMessage, String> {
    match platform {
        Platform::Discord => platforms::parse_discord_payload(raw_payload),
        Platform::Slack => platforms::parse_slack_payload(raw_payload),
        Platform::Telegram => platforms::parse_telegram_payload(raw_payload),
        Platform::Unknown => Err("Unknown platform".to_string()),
    }
}

async fn health_handler() -> Result<Response<Body>, hyper::Error> {
    Ok(response_json(StatusCode::OK, json!({
        "status": "healthy",
        "service": "gateway-http"
    })))
}

async fn config_handler(
    manager: SharedGatewayManager,
) -> Result<Response<Body>, hyper::Error> {
    let guard = manager.lock().await;
    let config = guard.config.clone().unwrap_or_default();
    let config_json = serde_json::to_string(&config).unwrap_or("{}".to_string());
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::from(config_json))
        .unwrap())
}

/// Handler for server capabilities endpoint
async fn capabilities_handler(
    manager: SharedGatewayManager,
) -> Result<Response<Body>, hyper::Error> {
    let guard = manager.lock().await;

    // Build server capabilities
    let mut capabilities = ServerCapabilities::new();

    // Update instance ID from config if available
    if let Some(ref config) = guard.config {
        if let Some(ref instance_id) = config.default_assistant_id {
            capabilities.instance_id = instance_id.clone();
        }
    }

    let capabilities_json = serde_json::to_string(&capabilities)
        .unwrap_or("{}".to_string());

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::from(capabilities_json))
        .unwrap())
}

/// Handler for capability negotiation endpoint
async fn negotiate_handler(
    body: Body,
    manager: SharedGatewayManager,
) -> Result<Response<Body>, hyper::Error> {
    let body_bytes = hyper::body::to_bytes(body).await?;
    let body_str = String::from_utf8_lossy(&body_bytes);

    let client_caps: ClientCapabilities = match serde_json::from_str(&body_str) {
        Ok(c) => c,
        Err(e) => {
            return Ok(response_json(StatusCode::BAD_REQUEST, json!({
                "error": format!("Invalid JSON: {}", e)
            })));
        }
    };

    let server_caps = {
        let guard = manager.lock().await;
        let mut caps = ServerCapabilities::new();
        if let Some(ref config) = guard.config {
            if let Some(ref instance_id) = config.default_assistant_id {
                caps.instance_id = instance_id.clone();
            }
        }
        caps
    };

    let result = negotiate_capabilities(&client_caps, &server_caps);
    let result_json = serde_json::to_string(&result).unwrap_or("{}".to_string());

    let status = if result.success {
        StatusCode::OK
    } else {
        StatusCode::BAD_REQUEST
    };

    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::from(result_json))
        .unwrap())
}

/// Get idempotency cache from manager, creating one if needed
fn get_or_create_idempotency_cache(_manager: &GatewayManager) -> &Mutex<IdempotencyCache> {
    // Note: In a real implementation, we'd store this in GatewayManager
    // For now, we use a global cache with OnceLock for safe initialization
    IDEMPOTENCY_CACHE.get_or_init(|| Mutex::new(IdempotencyCache::new()))
}

async fn webhook_handler(
    platform_str: String,
    body: Body,
    manager: SharedGatewayManager,
    idempotency_cache: Option<SharedIdempotencyCache>,
) -> Result<Response<Body>, hyper::Error> {
    log::info!("[FLOW-1] [HTTP] 📥 RECEIVED webhook for platform: {}", platform_str);
    let platform = Platform::from_str(&platform_str);

    if matches!(platform, Platform::Unknown) {
        log::warn!("[FLOW-1] [HTTP] ❌ Unknown platform: {}", platform_str);
        return Ok(response_json(StatusCode::BAD_REQUEST, json!({
            "error": "Unknown platform",
            "supported": ["discord", "slack", "telegram"]
        })));
    }

    let body_bytes = hyper::body::to_bytes(body).await?;
    let body_str = String::from_utf8_lossy(&body_bytes);
    log::debug!("[FLOW-1] [HTTP] Raw payload: {}", &body_str[..body_str.len().min(500)]);

    let raw_payload: serde_json::Value = match serde_json::from_str(&body_str) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[FLOW-1] [HTTP] ❌ Invalid JSON from {}: {}", platform_str, e);
            return Ok(response_json(StatusCode::BAD_REQUEST, json!({
                "error": format!("Invalid JSON: {}", e)
            })));
        }
    };

    log::info!("[FLOW-2] [HTTP] 🔍 Parsing {} payload...", platform_str);
    let message = match parse_platform_payload(platform, &raw_payload) {
        Ok(msg) => {
            log::info!("[FLOW-2] [HTTP] ✅ Parsed {} message:", platform_str);
            log::info!("[FLOW-2] [HTTP]    - message_id: {}", msg.id);
            log::info!("[FLOW-2] [HTTP]    - user_id: {}", msg.user_id);
            log::info!("[FLOW-2] [HTTP]    - channel_id: {}", msg.channel_id);
            log::info!("[FLOW-2] [HTTP]    - content: '{}'", msg.content.chars().take(80).collect::<String>());
            msg
        }
        Err(e) => {
            log::warn!("[FLOW-2] [HTTP] ❌ Failed to parse {} payload: {}", platform_str, e);
            return Ok(response_json(StatusCode::BAD_REQUEST, json!({
                "error": format!("Failed to parse payload: {}", e)
            })));
        }
    };

    // Check protocol version compatibility
    if !message.is_version_compatible() {
        log::warn!(
            "[FLOW-2] [HTTP] ❌ Protocol version mismatch: message={}, expected={}",
            message.protocol_version,
            GATEWAY_PROTOCOL_VERSION
        );
        return Ok(response_json(StatusCode::BAD_REQUEST, json!({
            "error": "Protocol version mismatch",
            "client_version": message.protocol_version,
            "server_version": GATEWAY_PROTOCOL_VERSION
        })));
    }

    // Check for duplicate messages using idempotency cache (only for Discord)
    if message.platform == Platform::Discord {
        if let Some(ref cache) = idempotency_cache {
            let mut cache_guard = cache.lock().await;
            let guild_id = message.guild_id.as_deref();
            let is_duplicate = cache_guard.check_and_mark(
                &message.id,
                &message.channel_id,
                guild_id,
                message.timestamp as i64,
            );

            if is_duplicate {
                log::info!(
                    "[FLOW-2] [HTTP] 🔄 Duplicate message detected: {} - returning 200 OK",
                    message.id
                );
                // Return 200 OK for duplicates (Discord expects this for webhook retries)
                return Ok(response_json(StatusCode::OK, json!({
                    "status": "duplicate",
                    "message_id": message.id
                })));
            }
        }
    }

    let msg_clone = message.clone();
    let platform_for_log = msg_clone.platform.as_str();

    log::info!("[FLOW-3] [HTTP] 📤 Queueing message {} to gateway queue", msg_clone.id);
    let manager_guard = manager.lock().await;
    if let Err(e) = manager_guard.message_queue.send(message).await {
        log::error!("[FLOW-3] [HTTP] ❌ Failed to queue message {}: {}", msg_clone.id, e);
        return Ok(response_json(StatusCode::INTERNAL_SERVER_ERROR, json!({
            "error": "Failed to process message"
        })));
    }

    let queue_size = manager_guard.message_queue.len();
    log::info!("[FLOW-3] [HTTP] ✅ Message {} queued. Queue size: {}", msg_clone.id, queue_size);

    Ok(response_json(StatusCode::ACCEPTED, json!({
        "status": "accepted",
        "message_id": msg_clone.id,
        "platform": platform_for_log
    })))
}

async fn route_request(
    req: Request<Body>,
    manager: SharedGatewayManager,
    idempotency_cache: Option<SharedIdempotencyCache>,
) -> Result<Response<Body>, hyper::Error> {
    let path = req.uri().path();
    let method = req.method().clone();

    match (method.as_str(), path) {
        ("GET", "/health") => health_handler().await,
        ("GET", "/api/config") => config_handler(manager).await,
        ("GET", "/api/capabilities") => capabilities_handler(manager).await,
        ("POST", "/api/capabilities/negotiate") => {
            let (_, body) = req.into_parts();
            negotiate_handler(body, manager).await
        }
        ("POST", "/api/configure/discord") => {
            let (_, body) = req.into_parts();
            configure_discord_handler(body, manager).await
        }
        ("POST", path) if path.starts_with("/webhook/") => {
            let platform = path.trim_start_matches("/webhook/").to_string();
            let (_, body) = req.into_parts();
            webhook_handler(platform, body, manager, idempotency_cache).await
        }
        _ => Ok(response_json(StatusCode::NOT_FOUND, json!({
            "error": "Not found"
        }))),
    }
}

async fn configure_discord_handler(
    body: Body,
    manager: SharedGatewayManager,
) -> Result<Response<Body>, hyper::Error> {
    let body_bytes = hyper::body::to_bytes(body).await?;
    let body_str = String::from_utf8_lossy(&body_bytes);

    #[derive(serde::Deserialize)]
    struct DiscordConfigRequest {
        webhook_url: Option<String>,
        bot_token: Option<String>,
    }

    let config_request: DiscordConfigRequest = match serde_json::from_str(&body_str) {
        Ok(c) => c,
        Err(e) => {
            return Ok(response_json(StatusCode::BAD_REQUEST, json!({
                "error": format!("Invalid JSON: {}", e)
            })));
        }
    };

    // Clone for multiple uses
    let webhook_url = config_request.webhook_url.clone();
    let bot_token = config_request.bot_token.clone();

    let mut manager_guard = manager.lock().await;

    // Configure Discord sender
    let discord_config = super::super::platforms::discord_sender::DiscordConfig {
        webhook_url: webhook_url.clone(),
        bot_token: bot_token.clone(),
    };
    manager_guard.discord_sender.lock().await.configure(discord_config);

    // Also update stored config
    if let Some(ref mut config) = manager_guard.config {
        config.discord_webhook_url = webhook_url;
        config.discord_bot_token = bot_token;
    }

    let configured = manager_guard.discord_sender.lock().await.is_configured();

    if configured {
        log::info!("[HTTP] Discord configured via API");
        Ok(response_json(StatusCode::OK, json!({
            "status": "configured",
            "method": if config_request.webhook_url.is_some() { "webhook" } else { "bot" }
        })))
    } else {
        Ok(response_json(StatusCode::BAD_REQUEST, json!({
            "error": "No webhook_url or bot_token provided"
        })))
    }
}

pub async fn start_http_server(
    manager: SharedGatewayManager,
    config: GatewayConfig,
) -> Result<HttpServerHandle, String> {
    let host = "127.0.0.1".to_string();
    let port = config.http_port;
    let addr = format!("{}:{}", host, port).parse().map_err(|e| format!("Invalid address: {}", e))?;

    log::info!("Starting HTTP gateway server on {}", addr);

    // Create shared idempotency cache
    let idempotency_cache: SharedIdempotencyCache = Arc::new(Mutex::new(IdempotencyCache::new()));

    // SharedGatewayManager is already Arc<Mutex<GatewayManager>>, just clone it
    let manager = manager.clone();
    let host_for_handle = host.clone();
    let cache_for_connections = idempotency_cache.clone();

    let make_svc = make_service_fn(move |_conn| {
        let manager = manager.clone();
        let cache = cache_for_connections.clone();
        async move {
            Ok::<_, hyper::Error>(service_fn(move |req| {
                route_request(req, manager.clone(), Some(cache.clone()))
            }))
        }
    });

    let server = Server::bind(&addr).serve(make_svc);

    let handle = HttpServerHandle::new(host_for_handle, port);

    let _ = tokio::spawn(async move {
        if let Err(e) = server.await {
            log::error!("HTTP server error: {}", e);
        }
    });

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    log::info!("HTTP gateway server started on http://{}:{}", host, port);

    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Mutex;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_health_endpoint() {
        let manager: SharedGatewayManager = Arc::new(Mutex::new(super::super::GatewayManager::new()));
        let response = health_handler().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_webhook_unknown_platform() {
        let manager: SharedGatewayManager = Arc::new(Mutex::new(super::super::GatewayManager::new()));
        let cache: SharedIdempotencyCache = Arc::new(Mutex::new(IdempotencyCache::new()));
        let body = Body::empty();
        let response = webhook_handler("unknown".to_string(), body, manager, Some(cache)).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_capabilities_endpoint() {
        let manager: SharedGatewayManager = Arc::new(Mutex::new(super::super::GatewayManager::new()));
        let response = capabilities_handler(manager).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}