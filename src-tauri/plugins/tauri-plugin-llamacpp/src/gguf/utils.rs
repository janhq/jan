use crate::gguf::helpers;
use crate::gguf::types::GgufMetadata;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use thiserror;

#[derive(Debug, Serialize, Deserialize)]
pub struct KVCacheEstimate {
    pub size: u64,
    pub per_token_size: u64,
}
#[derive(Debug, thiserror::Error)]
pub enum KVCacheError {
    #[error("Invalid metadata: architecture not found")]
    ArchitectureNotFound,
    #[error("Invalid metadata: block_count not found or invalid")]
    BlockCountInvalid,
    #[error("Invalid metadata: head_count not found or invalid")]
    HeadCountInvalid,
    #[error("Invalid metadata: embedding_length not found or invalid")]
    EmbeddingLengthInvalid,
    #[error("Invalid metadata: context_length not found or invalid")]
    ContextLengthInvalid,
}

impl serde::Serialize for KVCacheError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// read gguf metadata
pub async fn read_gguf_metadata_internal(path: String) -> Result<GgufMetadata, String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        // Remote: read in 2MB chunks until successful
        let client = reqwest::Client::new();
        let chunk_size = 2 * 1024 * 1024; // Fixed 2MB chunks
        let max_total_size = 120 * 1024 * 1024; // Don't exceed 120MB total
        let mut total_downloaded = 0;
        let mut accumulated_data = Vec::new();

        while total_downloaded < max_total_size {
            let start = total_downloaded;
            let end = std::cmp::min(start + chunk_size - 1, max_total_size - 1);

            let resp = client
                .get(&path)
                .header("Range", format!("bytes={}-{}", start, end))
                .send()
                .await
                .map_err(|e| format!("Failed to fetch chunk {}-{}: {}", start, end, e))?;

            let chunk_data = resp
                .bytes()
                .await
                .map_err(|e| format!("Failed to read chunk response: {}", e))?;

            accumulated_data.extend_from_slice(&chunk_data);
            total_downloaded += chunk_data.len();

            // Try parsing after each chunk
            let cursor = std::io::Cursor::new(&accumulated_data);
            if let Ok(metadata) = helpers::read_gguf_metadata(cursor) {
                return Ok(metadata);
            }

            // If we got less data than expected, we've reached EOF
            if chunk_data.len() < chunk_size {
                break;
            }
        }
        Err("Could not parse GGUF metadata from downloaded data".to_string())
    } else {
        // Local: use streaming file reader
        let file =
            File::open(&path).map_err(|e| format!("Failed to open local file {}: {}", path, e))?;
        let reader = BufReader::new(file);

        helpers::read_gguf_metadata(reader)
            .map_err(|e| format!("Failed to parse GGUF metadata: {}", e))
    }
}

/// Estimate KVCache size from a given metadata
pub async fn estimate_kv_cache_internal(
    meta: HashMap<String, String>,
    ctx_size: Option<u64>,
) -> Result<KVCacheEstimate, KVCacheError> {
    log::info!("Received ctx_size parameter: {:?}", ctx_size);
    // Get architecture
    let arch = meta
        .get("general.architecture")
        .ok_or(KVCacheError::ArchitectureNotFound)?;

    // Get number of layers
    let n_layer_key = format!("{}.block_count", arch);
    let n_layer = meta
        .get(&n_layer_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .ok_or(KVCacheError::BlockCountInvalid)?;

    // Get number of heads
    let n_head_key = format!("{}.attention.head_count", arch);
    let n_head = meta
        .get(&n_head_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .ok_or(KVCacheError::HeadCountInvalid)?;

    // Try to get key/value lengths first (more accurate)
    let key_len_key = format!("{}.attention.key_length", arch);
    let val_len_key = format!("{}.attention.value_length", arch);

    let key_len = meta.get(&key_len_key).and_then(|s| s.parse::<u64>().ok());
    let val_len = meta.get(&val_len_key).and_then(|s| s.parse::<u64>().ok());

    let head_dim = if let (Some(key_len), Some(val_len)) = (key_len, val_len) {
        // Use explicit key/value lengths if available
        log::info!(
            "Using explicit key_length: {}, value_length: {}",
            key_len,
            val_len
        );
        key_len + val_len
    } else {
        // Fall back to embedding_length estimation
        let embedding_len_key = format!("{}.embedding_length", arch);
        let embedding_len = meta
            .get(&embedding_len_key)
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|&n| n > 0)
            .ok_or(KVCacheError::EmbeddingLengthInvalid)?;

        // Standard transformer: head_dim = embedding_dim / num_heads
        // For KV cache: we need both K and V, so 2 * head_dim per head
        let calculated_head_dim = embedding_len / n_head;
        log::info!(
            "Using embedding_length estimation: {}, calculated head_dim: {}",
            embedding_len,
            calculated_head_dim
        );
        calculated_head_dim
    };

    // Get maximum context length
    let max_ctx_key = format!("{}.context_length", arch);
    let max_ctx = meta
        .get(&max_ctx_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .ok_or(KVCacheError::ContextLengthInvalid)?;

    // If the user supplied a value, clamp it to the model's max
    let ctx_len = ctx_size.map(|size| size.min(max_ctx)).unwrap_or(max_ctx);

    log::info!("Final context length used for KV size: {}", ctx_len);
    log::info!(
        "n_layer: {}, n_head: {}, head_dim (K+V): {}",
        n_layer,
        n_head,
        head_dim
    );
    log::info!("ctx_len: {}", ctx_len);
    log::info!("n_layer: {}", n_layer);
    log::info!("n_head: {}", n_head);
    log::info!("head_dim: {}", head_dim);

    // Consider f16 by default
    // Can be extended by checking cache-type-v and cache-type-k
    // but we are checking overall compatibility with the default settings
    // fp16 = 8 bits * 2 = 16
    const BYTES_PER_ELEMENT: u64 = 2;

    // Total KV cache size per token = n_head * head_dim * bytes_per_element * n_layer
    let kv_per_token = n_head * head_dim * 2 * BYTES_PER_ELEMENT * n_layer;

    Ok(KVCacheEstimate {
        size: ctx_len * kv_per_token,
        per_token_size: kv_per_token,
    })
}
