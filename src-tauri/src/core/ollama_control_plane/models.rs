use serde::{Deserialize, Serialize};

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

fn option_string_is_none_or_empty(value: &Option<String>) -> bool {
    match value {
        None => true,
        Some(v) => v.is_empty(),
    }
}

fn option_i64_vec_is_none_or_empty(value: &Option<Vec<i64>>) -> bool {
    match value {
        None => true,
        Some(v) => v.is_empty(),
    }
}

fn option_string_vec_is_none_or_empty(value: &Option<Vec<String>>) -> bool {
    match value {
        None => true,
        Some(v) => v.is_empty(),
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum OllamaRunModelKeepAliveRequest {
    Number(i64),
    Text(String),
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum OllamaRunModelThinkRequest {
    Boolean(bool),
    Level(String),
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct OllamaRunModelOptionsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_batch: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_gpu: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_gpu: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_mmap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_thread: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_keep: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typical_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_last_n: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f64>,
    #[serde(skip_serializing_if = "option_string_vec_is_none_or_empty")]
    pub stop: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OllamaRunModelRequest {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<OllamaRunModelKeepAliveRequest>,
    #[serde(skip_serializing_if = "option_string_is_none_or_empty")]
    pub suffix: Option<String>,
    #[serde(skip_serializing_if = "option_string_is_none_or_empty")]
    pub system: Option<String>,
    #[serde(skip_serializing_if = "option_string_is_none_or_empty")]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "option_i64_vec_is_none_or_empty")]
    pub context: Option<Vec<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub think: Option<OllamaRunModelThinkRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logprobs: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_logprobs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _debug_render_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<OllamaRunModelOptionsRequest>,
}
