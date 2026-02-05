use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tungstenite::protocol::Message;

use super::super::{SharedGatewayManager, protocol::{ProtocolHandler, EventFrame}};
use super::WsServerHandle;
use crate::core::gateway::types::{WebSocketMessage, WebSocketOutgoing, Platform};
use crate::core::gateway::protocol::frames::{ProtocolFrame, error_codes};

type WsStream = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;

/// Maximum buffered bytes before marking a client as slow
const BACKPRESSURE_THRESHOLD: usize = 1024 * 512; // 512 KB

/// Hello challenge timeout
const HELLO_TIMEOUT_SECS: u64 = 10;

/// WebSocket client session
struct WsSession {
    addr: SocketAddr,
    client_id: String,
    subscribed_platforms: Vec<Platform>,
    last_activity: std::time::Instant,
    /// Whether the client has completed the hello handshake
    authenticated: bool,
    /// Outbound buffer size tracking for backpressure
    buffered_bytes: Arc<AtomicUsize>,
    /// Client user-agent / identifier from hello
    client_info: Option<String>,
}

impl WsSession {
    fn new(addr: SocketAddr) -> Self {
        Self {
            addr,
            client_id: uuid::Uuid::new_v4().to_string(),
            subscribed_platforms: Vec::new(),
            last_activity: std::time::Instant::now(),
            authenticated: false,
            buffered_bytes: Arc::new(AtomicUsize::new(0)),
            client_info: None,
        }
    }

    /// Check if client is slow (backpressure)
    fn is_slow(&self) -> bool {
        self.buffered_bytes.load(Ordering::Relaxed) > BACKPRESSURE_THRESHOLD
    }
}

/// Hello handshake frame from client
#[derive(serde::Deserialize)]
struct HelloFrame {
    #[serde(default)]
    auth: Option<HelloAuth>,
    #[serde(default)]
    client: Option<String>,
}

#[derive(serde::Deserialize)]
struct HelloAuth {
    token: Option<String>,
}

/// Perform the hello challenge handshake
///
/// 1. Server sends `connect.challenge` event with nonce
/// 2. Client must respond with `hello` frame containing auth token
/// 3. Server validates and sends `hello-ok` or closes connection
async fn perform_hello_handshake(
    tx: &mut futures_util::stream::SplitSink<WsStream, Message>,
    rx: &mut futures_util::stream::SplitStream<WsStream>,
    session: &Arc<Mutex<WsSession>>,
    manager: &SharedGatewayManager,
) -> bool {
    let client_id = session.lock().await.client_id.clone();
    let nonce = uuid::Uuid::new_v4().to_string();
    let server_time = chrono::Utc::now().timestamp_millis();

    // Step 1: Send challenge
    let challenge = EventFrame::new("connect.challenge", serde_json::json!({
        "nonce": nonce,
        "ts": server_time,
        "protocolVersion": crate::core::gateway::protocol::PROTOCOL_VERSION,
    }));
    if tx.send(Message::Text(challenge.to_json().unwrap_or_default())).await.is_err() {
        return false;
    }

    // Step 2: Wait for hello response with timeout
    let hello_result = tokio::time::timeout(
        Duration::from_secs(HELLO_TIMEOUT_SECS),
        rx.next(),
    ).await;

    let hello_msg = match hello_result {
        Ok(Some(Ok(Message::Text(text)))) => text,
        Ok(Some(Ok(_))) => {
            log::warn!("[WS] Client {} sent non-text message during handshake", client_id);
            let _ = send_error(tx, "HANDSHAKE_FAILED", "Expected text frame for hello").await;
            return false;
        }
        Ok(Some(Err(e))) => {
            log::warn!("[WS] WebSocket error during hello from {}: {}", client_id, e);
            return false;
        }
        Ok(None) => {
            log::warn!("[WS] Client {} disconnected during hello", client_id);
            return false;
        }
        Err(_) => {
            log::warn!("[WS] Client {} hello timeout ({}s)", client_id, HELLO_TIMEOUT_SECS);
            let _ = send_error(tx, "HELLO_TIMEOUT", "Hello handshake timed out").await;
            return false;
        }
    };

    // Step 3: Parse and validate hello
    let hello: HelloFrame = match serde_json::from_str(&hello_msg) {
        Ok(h) => h,
        Err(e) => {
            log::warn!("[WS] Client {} sent invalid hello: {}", client_id, e);
            let _ = send_error(tx, "INVALID_HELLO", "Could not parse hello frame").await;
            return false;
        }
    };

    // Validate auth token if configured
    let auth_required = {
        let guard = manager.lock().await;
        guard.config.as_ref().and_then(|c| c.auth_token.clone())
    };

    if let Some(ref expected_token) = auth_required {
        let provided_token = hello.auth
            .as_ref()
            .and_then(|a| a.token.as_deref())
            .unwrap_or("");

        if provided_token != expected_token {
            log::warn!("[WS] Client {} failed authentication", client_id);
            let _ = send_error(tx, error_codes::UNAUTHORIZED, "Invalid auth token").await;
            return false;
        }
    }

    // Step 4: Send hello-ok
    let mut sess = session.lock().await;
    sess.authenticated = true;
    sess.client_info = hello.client;

    let hello_ok = EventFrame::new("hello-ok", serde_json::json!({
        "clientId": client_id,
        "connectedAt": chrono::Utc::now().timestamp_millis(),
        "protocolVersion": crate::core::gateway::protocol::PROTOCOL_VERSION,
        "authRequired": auth_required.is_some(),
    }));
    drop(sess);

    if tx.send(Message::Text(hello_ok.to_json().unwrap_or_default())).await.is_err() {
        return false;
    }

    log::info!("[WS] Client {} authenticated successfully", client_id);
    true
}

/// Send an error frame and close hint
async fn send_error(
    tx: &mut futures_util::stream::SplitSink<WsStream, Message>,
    code: &str,
    message: &str,
) -> Result<(), tungstenite::Error> {
    let error_event = EventFrame::new("gateway.error", serde_json::json!({
        "code": code,
        "message": message,
    }));
    tx.send(Message::Text(error_event.to_json().unwrap_or_default())).await?;
    tx.send(Message::Close(None)).await?;
    Ok(())
}

/// Track outbound message bytes for backpressure
async fn send_tracked(
    tx: &mut futures_util::stream::SplitSink<WsStream, Message>,
    session: &Arc<Mutex<WsSession>>,
    text: String,
) -> Result<(), tungstenite::Error> {
    let bytes = text.len();
    let buffered = session.lock().await.buffered_bytes.clone();
    buffered.fetch_add(bytes, Ordering::Relaxed);

    let result = tx.send(Message::Text(text)).await;

    // Decrement after send completes (approximation — actual TCP buffer is separate)
    buffered.fetch_sub(bytes, Ordering::Relaxed);
    result
}

/// Handle a WebSocket connection with hello handshake and backpressure
async fn handle_ws_connection(
    stream: tokio::net::TcpStream,
    manager: SharedGatewayManager,
    addr: SocketAddr,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::warn!("WebSocket handshake failed for {}: {}", addr, e);
            return;
        }
    };

    let (mut tx, mut rx) = ws_stream.split();
    let session = Arc::new(Mutex::new(WsSession::new(addr)));
    let client_id = session.lock().await.client_id.clone();

    log::info!("[WS] New connection from: {} (id: {})", addr, client_id);

    // Perform hello handshake (auth + challenge)
    if !perform_hello_handshake(&mut tx, &mut rx, &session, &manager).await {
        log::warn!("[WS] Client {} failed handshake, closing", client_id);
        return;
    }

    // Create protocol handler for this authenticated connection
    let protocol_handler = ProtocolHandler::new(manager.clone(), client_id.clone());

    // Main message loop
    while let Some(msg) = rx.next().await {
        match msg {
            Ok(msg) => {
                if let Message::Text(text) = msg {
                    {
                        let mut sess = session.lock().await;
                        sess.last_activity = std::time::Instant::now();
                    }

                    // Check backpressure before processing
                    if session.lock().await.is_slow() {
                        log::warn!("[WS] Client {} is slow, dropping message", client_id);
                        // Send backpressure warning
                        let warning = EventFrame::new("gateway.backpressure", serde_json::json!({
                            "warning": "Client buffer full, some events may be dropped",
                            "buffered_bytes": session.lock().await.buffered_bytes.load(Ordering::Relaxed),
                        }));
                        let _ = send_tracked(&mut tx, &session, warning.to_json().unwrap_or_default()).await;
                        continue;
                    }

                    // Try to parse as new protocol frame first
                    match ProtocolFrame::from_json(&text) {
                        Ok(frame) => {
                            // Handle using new protocol handler
                            if let Some(response) = super::super::protocol::handler::process_frame(frame, &protocol_handler).await {
                                let response_text = response.to_json().unwrap_or_default();
                                let _ = send_tracked(&mut tx, &session, response_text).await;
                            }
                        }
                        Err(_) => {
                            // Fall back to legacy WebSocketMessage format
                            if let Err(e) = handle_ws_message_legacy(&session, &manager, &mut tx, &text).await {
                                log::warn!("Error handling WS message from {}: {}", addr, e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("WebSocket error for {}: {}", addr, e);
                break;
            }
        }
    }

    log::info!("[WS] Client {} disconnected", client_id);
}

/// Handle incoming WebSocket message (legacy format for backward compatibility)
async fn handle_ws_message_legacy(
    session: &Arc<Mutex<WsSession>>,
    manager: &SharedGatewayManager,
    tx: &mut futures_util::stream::SplitSink<WsStream, Message>,
    text: &str,
) -> Result<(), String> {
    let msg: Result<WebSocketMessage, _> = serde_json::from_str(text);

    match msg {
        Ok(WebSocketMessage::Ping) => {
            let response = serde_json::to_string(&WebSocketOutgoing::Pong).unwrap();
            let _ = tx.send(Message::Text(response)).await;
        }
        Ok(WebSocketMessage::Subscribe { platform }) => {
            let mut session_guard = session.lock().await;
            if !session_guard.subscribed_platforms.contains(&platform) {
                session_guard.subscribed_platforms.push(platform.clone());
            }
            let mut manager_guard = manager.lock().await;
            manager_guard.connections.insert(platform.clone(),
                crate::core::gateway::types::ConnectionState {
                    platform: platform.clone(),
                    connected: true,
                    last_heartbeat: chrono::Utc::now().timestamp_millis() as u64,
                    message_count: 0,
                }
            );
        }
        Ok(WebSocketMessage::Unsubscribe { platform }) => {
            let mut session_guard = session.lock().await;
            session_guard.subscribed_platforms.retain(|p| p != &platform);
        }
        Ok(WebSocketMessage::Message(message)) => {
            let mut manager_guard = manager.lock().await;
            manager_guard.connections.entry(message.platform.clone()).and_modify(|c| {
                c.message_count += 1;
                c.last_heartbeat = chrono::Utc::now().timestamp_millis() as u64;
            });

            if let Err(e) = manager_guard.message_queue.send(message).await {
                log::error!("Failed to queue message: {}", e);
            }
        }
        Err(e) => {
            let error = serde_json::to_string(&WebSocketOutgoing::Error {
                message: format!("Invalid message format: {}", e)
            }).unwrap();
            let _ = tx.send(Message::Text(error)).await;
        }
    }

    Ok(())
}

/// Start the WebSocket server
pub async fn start_ws_server(
    manager: SharedGatewayManager,
    host: String,
    port: u16,
) -> Result<WsServerHandle, String> {
    let addr = format!("{}:{}", host, port);
    log::info!("Starting WebSocket gateway server on {}", addr);

    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind WebSocket server: {}", e))?;

    let handle = WsServerHandle::new(host.clone(), port);
    let shutdown = handle.shutdown_handle();

    // Spawn connection handler
    tokio::spawn(async move {
        loop {
            if shutdown.load(Ordering::SeqCst) {
                log::info!("WebSocket server shutting down");
                break;
            }

            match listener.accept().await {
                Ok((stream, addr)) => {
                    let mgr = manager.clone();
                    tokio::spawn(async move {
                        handle_ws_connection(stream, mgr, addr).await;
                    });
                }
                Err(e) => {
                    log::warn!("Failed to accept WebSocket connection: {}", e);
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    log::info!("WebSocket server started on ws://{}:{}/", host, port);

    Ok(handle)
}
