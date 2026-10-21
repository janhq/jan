use std::collections::HashMap;
use std::sync::Arc;

use tokio::process::Child;
use tokio::sync::Mutex;

/// Information about a running engine session.
///
/// The engine itself lives in a sidecar process; this is the handle Jan keeps
/// so it can talk to the session over HTTP and stop it later.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionInfo {
    /// The provider id of the engine that owns the session ("litert-lm", ...).
    pub engine: String,
    /// The model id the session was started for.
    pub model_id: String,
    /// Filesystem path of the loaded model.
    pub model_path: String,
    /// Port the sidecar listens on.
    pub port: i32,
    /// Bearer token the sidecar requires.
    pub api_key: String,
    /// Process id of the sidecar.
    pub pid: i32,
}

#[derive(Debug)]
pub struct EngineSession {
    pub info: SessionInfo,
    pub child: Arc<Mutex<Child>>,
}

/// Shared state holding every running engine session.
#[derive(Default)]
pub struct LocalEngineState {
    pub sessions: Mutex<HashMap<i32, EngineSession>>,
}

impl LocalEngineState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}
