use super::types::GgufMetadata;
use super::utils::{
    estimate_kv_cache_internal, read_gguf_metadata_internal, KVCacheError, KVCacheEstimate,
};
use std::collections::HashMap;

/// Read GGUF metadata from a model file
#[tauri::command]
pub async fn read_gguf_metadata(path: String) -> Result<GgufMetadata, String> {
    return read_gguf_metadata_internal(path).await;
}

#[tauri::command]
pub async fn estimate_kv_cache_size(
    meta: HashMap<String, String>,
    ctx_size: Option<u64>,
) -> Result<KVCacheEstimate, KVCacheError> {
    estimate_kv_cache_internal(meta, ctx_size).await
}
