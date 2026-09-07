use serde::{Deserialize, Serialize};
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
    /// The supervised engine worker, when one is running.
    pub engine: Mutex<Option<crate::engine::worker::WorkerHandle>>,
    /// Persistent `/models/sse` subscriber, alive for the worker's lifetime.
    /// It is what turns an eviction Jan did not initiate into a frontend
    /// event, so it is aborted whenever the worker stops.
    pub unload_watcher: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Default for LlamacppState {
    fn default() -> Self {
        Self {
            engine: Mutex::new(None),
            unload_watcher: Mutex::new(None),
        }
    }
}

impl LlamacppState {
    pub fn new() -> Self {
        Self::default()
    }
}
