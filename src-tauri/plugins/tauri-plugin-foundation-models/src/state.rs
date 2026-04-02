use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct FoundationModelsState {
    pub loaded: Arc<Mutex<bool>>,
    /// Request IDs that have been signalled for cancellation.
    /// Checked by the streaming callback to stop emitting events.
    pub cancel_tokens: Arc<std::sync::Mutex<HashSet<String>>>,
}

impl Default for FoundationModelsState {
    fn default() -> Self {
        Self {
            loaded: Arc::new(Mutex::new(false)),
            cancel_tokens: Arc::new(std::sync::Mutex::new(HashSet::new())),
        }
    }
}

impl FoundationModelsState {
    pub fn new() -> Self {
        Self::default()
    }
}
