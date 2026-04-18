use serde::Serialize;

/// Detailed information about an installed Ollama model.
/// Combines data from `/api/show` and `/api/tags`.
#[derive(Serialize)]
pub struct OllamaModelDetail {
    pub name: String,
    pub size: u64,
    pub digest: String,
    pub modified_at: String,
    pub details: serde_json::Value,
    pub modelfile: Option<String>,
    pub parameters: Option<String>,
    pub template: Option<String>,
}

/// Information about a model currently loaded in memory.
/// Maps to entries in `/api/ps` response.
#[derive(Serialize)]
pub struct OllamaRunningModel {
    pub name: String,
    pub model: String,
    pub size: u64,
    pub size_vram: u64,
    pub digest: String,
    pub details: serde_json::Value,
    pub expires_at: String,
}

/// Progress update for model pull or create operations.
/// Emitted as Tauri events while streaming JSONL from Ollama.
#[derive(Serialize, Clone)]
pub struct PullProgress {
    pub status: String,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
}
