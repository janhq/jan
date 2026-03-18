use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex;

/// Session information for a running Foundation Models server instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32,
    pub port: i32,
    pub model_id: String,
    pub api_key: String,
}

pub struct FoundationModelsBackendSession {
    pub child: Child,
    pub info: SessionInfo,
}

/// Plugin state — tracks all active server processes keyed by PID
pub struct FoundationModelsState {
    pub sessions: Arc<Mutex<HashMap<i32, FoundationModelsBackendSession>>>,
}

impl Default for FoundationModelsState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl FoundationModelsState {
    pub fn new() -> Self {
        Self::default()
    }
}
