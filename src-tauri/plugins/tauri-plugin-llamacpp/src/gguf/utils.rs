use crate::gguf::helpers;
use crate::gguf::types::{GgufMetadata, KVCacheError, KVCacheEstimate};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;

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
    let arch = meta
        .get("general.architecture")
        .ok_or(KVCacheError::ArchitectureNotFound)?;

    // Number of layers
    let n_layer_key = format!("{}.block_count", arch);
    let n_layer = meta
        .get(&n_layer_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .ok_or(KVCacheError::BlockCountInvalid)?;

    // Attention heads (use kv heads if present, else full heads)
    let n_head_key = format!("{}.attention.head_count", arch);
    let n_head_kv_key = format!("{}.attention.head_count_kv", arch);
    let n_head = meta
        .get(&n_head_kv_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or_else(|| {
            meta.get(&n_head_key)
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0)
        });
    if n_head == 0 {
        return Err(KVCacheError::HeadCountInvalid);
    }

    // Key/value dimensions
    let key_len_key = format!("{}.attention.key_length", arch);
    let val_len_key = format!("{}.attention.value_length", arch);

    let mut key_len = meta
        .get(&key_len_key)
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let mut val_len = meta
        .get(&val_len_key)
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    // Fallback: calculate from embedding_length if key/val lengths not found
    if key_len == 0 || val_len == 0 {
        let emb_len_key = format!("{}.embedding_length", arch);
        let emb_len = meta
            .get(&emb_len_key)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        if emb_len > 0 && n_head > 0 {
            // For most transformers: head_dim = embedding_length / total_heads
            let total_heads = meta
                .get(&n_head_key)
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(n_head);

            let head_dim = emb_len / total_heads;
            key_len = head_dim;
            val_len = head_dim;

            log::info!(
                "Calculated key_len and val_len from embedding_length: {} / {} heads = {} per head",
                emb_len,
                total_heads,
                head_dim
            );
        }
    }

    if key_len == 0 || val_len == 0 {
        return Err(KVCacheError::EmbeddingLengthInvalid);
    }

    // Context length
    let max_ctx_key = format!("{}.context_length", arch);
    let max_ctx = meta
        .get(&max_ctx_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .ok_or(KVCacheError::ContextLengthInvalid)?;
    let ctx_len = ctx_size.map(|size| size.min(max_ctx)).unwrap_or(max_ctx);

    // Sliding window if present
    let sliding_key = format!("{}.attention.sliding_window", arch);
    let sliding_window = meta
        .get(&sliding_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0);

    // Assume fp16
    const BYTES_PER_ELEMENT: u64 = 2;

    // Per-token KV size
    let kv_per_token = n_layer * n_head * (key_len + val_len) * BYTES_PER_ELEMENT;

    // Pure full-attention cost
    let full_cost = ctx_len * kv_per_token;

    // Pure sliding-window cost (tiny, only keeps last W tokens)
    let sliding_cost = sliding_window.map(|w| w * kv_per_token);

    // Middle estimate: average of sliding + full if sliding_window is present
    let chosen_size = if let Some(slide) = sliding_cost {
        let middle = (full_cost + slide) / 2;
        log::info!(
            "KV estimates -> sliding: {} bytes (~{:.2} MB), full: {} bytes (~{:.2} MB), middle: {} bytes (~{:.2} MB)",
            slide,
            slide as f64 / (1024.0 * 1024.0),
            full_cost,
            full_cost as f64 / (1024.0 * 1024.0),
            middle,
            middle as f64 / (1024.0 * 1024.0)
        );
        middle
    } else {
        log::info!(
            "KV estimate (no SWA detected) -> full: {} bytes (~{:.2} MB)",
            full_cost,
            full_cost as f64 / (1024.0 * 1024.0)
        );
        full_cost
    };

    Ok(KVCacheEstimate {
        size: chosen_size,
        per_token_size: kv_per_token,
    })
}
