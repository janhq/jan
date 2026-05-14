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
    pub router: Mutex<Option<crate::router::RouterHandle>>,
}

impl Default for LlamacppState {
    fn default() -> Self {
        Self {
            router: Mutex::new(None),
        }
    }
}

impl LlamacppState {
    pub fn new() -> Self {
        Self::default()
    }
}
