use super::helpers;
use super::types::GgufMetadata;

/// Read GGUF metadata from a model file
#[tauri::command]
pub async fn read_gguf_metadata(path: String) -> Result<GgufMetadata, String> {
    helpers::read_gguf_metadata(&path).map_err(|e| format!("Failed to read GGUF metadata: {}", e))
}
