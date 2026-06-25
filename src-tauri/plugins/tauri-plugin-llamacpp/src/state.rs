use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicU32;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32,
    pub port: i32,
    pub model_id: String,
    pub is_embedding: bool,
    pub api_key: String,
}

pub struct LlamacppState {
    pub router: Mutex<Option<crate::router::RouterHandle>>,
    /// Mirror of the router PID for emergency lookup (e.g. force-kill while
    /// the handle is temporarily owned by the watcher loop). 0 = no router.
    pub router_pid: AtomicU32,
}

impl Default for LlamacppState {
    fn default() -> Self {
        Self {
            router: Mutex::new(None),
            router_pid: AtomicU32::new(0),
        }
    }
}

impl LlamacppState {
    pub fn new() -> Self {
        Self::default()
    }
}
