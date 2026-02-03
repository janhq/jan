//! Server module for HTTP and WebSocket handling

pub mod http_server;
pub mod websocket;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::{GatewayManager, SharedGatewayManager, GatewayConfig};
use crate::core::gateway::types::{GatewayMessage, Platform};

/// HTTP server handle for shutdown control
#[derive(Debug)]
pub struct HttpServerHandle {
    pub host: String,
    pub port: u16,
    shutdown: Arc<AtomicBool>,
}

impl HttpServerHandle {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn request_shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }

    pub fn should_shutdown(&self) -> bool {
        self.shutdown.load(Ordering::SeqCst)
    }

    pub fn shutdown_handle(&self) -> Arc<AtomicBool> {
        self.shutdown.clone()
    }
}

/// WebSocket server handle for shutdown control
#[derive(Debug, Clone)]
pub struct WsServerHandle {
    pub host: String,
    pub port: u16,
    shutdown: Arc<AtomicBool>,
}

impl WsServerHandle {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn request_shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }

    pub fn should_shutdown(&self) -> bool {
        self.shutdown.load(Ordering::SeqCst)
    }

    pub fn shutdown_handle(&self) -> Arc<AtomicBool> {
        self.shutdown.clone()
    }
}

/// Message sender trait for routing messages to the gateway
pub trait MessageReceiver: Send + Sync {
    fn receive_message(&self, message: GatewayMessage);
}

/// Trait for servers to emit events to Tauri frontend
pub trait EventEmitter: Send + Sync {
    fn emit_message(&self, message: &GatewayMessage);
    fn emit_status(&self, platform: Platform, connected: bool);
}