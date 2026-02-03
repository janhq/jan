use hyper::{Body, Request, Response, Server, StatusCode};
use hyper::service::{make_service_fn, service_fn};
use tokio::sync::Mutex;
use serde_json::json;

use super::super::{GatewayManager, SharedGatewayManager, GatewayConfig};
use super::HttpServerHandle;
use crate::core::gateway::types::{GatewayMessage, Platform};
use crate::core::gateway::platforms;

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

async fn webhook_handler(
    platform_str: String,
    body: Body,
    manager: SharedGatewayManager,
) -> Result<Response<Body>, hyper::Error> {
    let platform = Platform::from_str(&platform_str);
    log::info!("[HTTP] Received webhook for platform: {}", platform_str);

    if matches!(platform, Platform::Unknown) {
        log::warn!("[HTTP] Unknown platform: {}", platform_str);
        return Ok(response_json(StatusCode::BAD_REQUEST, json!({
            "error": "Unknown platform",
            "supported": ["discord", "slack", "telegram"]
        })));
    }

    let body_bytes = hyper::body::to_bytes(body).await?;
    let body_str = String::from_utf8_lossy(&body_bytes);
    log::debug!("[HTTP] Raw payload: {}", &body_str[..body_str.len().min(500)]);

    let raw_payload: serde_json::Value = match serde_json::from_str(&body_str) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[HTTP] Invalid JSON from {}: {}", platform_str, e);
            return Ok(response_json(StatusCode::BAD_REQUEST, json!({
                "error": format!("Invalid JSON: {}", e)
            })));
        }
    };

    let message = match parse_platform_payload(platform, &raw_payload) {
        Ok(msg) => {
            log::info!("[HTTP] Parsed {} message from {}: user={}, channel={}, content='{}'",
                platform_str, msg.id, msg.user_id, msg.channel_id,
                msg.content.chars().take(100).collect::<String>());
            msg
        }
        Err(e) => {
            log::warn!("[HTTP] Failed to parse {} payload: {}", platform_str, e);
            return Ok(response_json(StatusCode::BAD_REQUEST, json!({
                "error": format!("Failed to parse payload: {}", e)
            })));
        }
    };

    let msg_clone = message.clone();
    let platform_for_log = msg_clone.platform.as_str();

    let mut manager_guard = manager.lock().await;
    log::info!("[HTTP] Queueing message {} to gateway queue", msg_clone.id);
    if let Err(e) = manager_guard.message_queue.send(message).await {
        log::error!("[HTTP] Failed to queue message: {}", e);
        return Ok(response_json(StatusCode::INTERNAL_SERVER_ERROR, json!({
            "error": "Failed to process message"
        })));
    }
    log::info!("[HTTP] Message {} queued successfully. Queue size: {}",
        msg_clone.id, manager_guard.message_queue.len());

    Ok(response_json(StatusCode::ACCEPTED, json!({
        "status": "accepted",
        "message_id": msg_clone.id,
        "platform": platform_for_log
    })))
}

async fn route_request(
    req: Request<Body>,
    manager: SharedGatewayManager,
) -> Result<Response<Body>, hyper::Error> {
    let path = req.uri().path();
    let method = req.method().clone();

    match (method.as_str(), path) {
        ("GET", "/health") => health_handler().await,
        ("GET", "/api/config") => config_handler(manager).await,
        ("POST", path) if path.starts_with("/webhook/") => {
            let platform = path.trim_start_matches("/webhook/").to_string();
            let (_, body) = req.into_parts();
            webhook_handler(platform, body, manager).await
        }
        _ => Ok(response_json(StatusCode::NOT_FOUND, json!({
            "error": "Not found"
        }))),
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

    // SharedGatewayManager is already Arc<Mutex<GatewayManager>>, just clone it
    let manager = manager.clone();
    let host_for_handle = host.clone();

    let make_svc = make_service_fn(move |_conn| {
        let manager = manager.clone();
        async move {
            Ok::<_, hyper::Error>(service_fn(move |req| {
                route_request(req, manager.clone())
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
        let body = Body::empty();
        let response = webhook_handler("unknown".to_string(), body, manager).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}