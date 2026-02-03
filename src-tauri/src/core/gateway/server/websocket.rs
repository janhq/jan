use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tungstenite::protocol::Message;

use super::super::{SharedGatewayManager};
use super::WsServerHandle;
use crate::core::gateway::types::{WebSocketMessage, WebSocketOutgoing, Platform, GatewayMessage};

type WsStream = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;

/// WebSocket client session
struct WsSession {
    addr: SocketAddr,
    subscribed_platforms: Vec<Platform>,
    last_activity: std::time::Instant,
}

/// Handle a WebSocket connection
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
    let session = Arc::new(Mutex::new(WsSession {
        addr,
        subscribed_platforms: Vec::new(),
        last_activity: std::time::Instant::now(),
    }));

    log::info!("WebSocket client connected: {}", addr);

    // Main message loop
    while let Some(msg) = rx.next().await {
        match msg {
            Ok(msg) => {
                if let Message::Text(text) = msg {
                    session.lock().await.last_activity = std::time::Instant::now();
                    if let Err(e) = handle_ws_message(&session, &manager, &mut tx, &text).await {
                        log::warn!("Error handling WS message from {}: {}", addr, e);
                    }
                }
            }
            Err(e) => {
                log::warn!("WebSocket error for {}: {}", addr, e);
                break;
            }
        }
    }

    log::info!("WebSocket client {} disconnected", addr);
}

/// Handle incoming WebSocket message
async fn handle_ws_message(
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