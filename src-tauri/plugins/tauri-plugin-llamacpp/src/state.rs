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
    /// Persistent `/models/sse` subscriber (router-side unload notifications),
    /// alive for the router's lifetime. Aborted whenever the router stops.
    pub unload_watcher: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Default for LlamacppState {
    fn default() -> Self {
        Self {
            router: Mutex::new(None),
            router_pid: AtomicU32::new(0),
            unload_watcher: Mutex::new(None),
        }
    }
}

impl LlamacppState {
    pub fn new() -> Self {
        Self::default()
    }
}
