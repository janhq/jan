use crate::gguf::helpers;
use crate::gguf::types::{GgufMetadata, KVCacheError, KVCacheEstimate};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;

/// Runs a parse over a gguf, local or remote.
///
/// A remote file is fetched in range chunks and the parse retried after each
/// one, since neither the KV section nor the tensor-info block has a length
/// known up front. `what` names the parse in the error, which is all that
/// differs between callers -- the fetch loop is shared so the chunking rules
/// cannot drift apart.
async fn parse_gguf<T, F>(path: &str, what: &str, parse: F) -> Result<T, String>
where
    F: Fn(&mut (dyn ReadSeek + '_)) -> std::io::Result<T>,
{
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
                .get(path)
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
            let mut cursor = std::io::Cursor::new(accumulated_data.as_slice());
            if let Ok(parsed) = parse(&mut cursor) {
                return Ok(parsed);
            }

            // If we got less data than expected, we've reached EOF
            if chunk_data.len() < chunk_size {
                break;
            }
        }
        Err(format!("Could not read {} from downloaded data", what))
    } else {
        // Local: use streaming file reader
        let file =
            File::open(path).map_err(|e| format!("Failed to open local file {}: {}", path, e))?;
        let mut reader = BufReader::new(file);

        parse(&mut reader).map_err(|e| format!("Failed to parse {}: {}", what, e))
    }
}

/// One trait object for the two readers `parse_gguf` hands out, so the parse
/// closure does not have to be generic over both.
pub trait ReadSeek: std::io::Read + std::io::Seek {}
impl<T: std::io::Read + std::io::Seek> ReadSeek for T {}

// read gguf metadata
pub async fn read_gguf_metadata_internal(path: String) -> Result<GgufMetadata, String> {
    parse_gguf(&path, "GGUF metadata", |r: &mut (dyn ReadSeek + '_)| {
        helpers::read_gguf_metadata(r)
    })
    .await
}

/// Which of `names` exist as tensors in the gguf. See `find_gguf_tensors` for
/// why this is an exact-name question rather than a listing.
pub async fn find_gguf_tensors_internal(
    path: String,
    names: Vec<String>,
) -> Result<Vec<String>, String> {
    parse_gguf(&path, "GGUF tensor names", |r: &mut (dyn ReadSeek + '_)| {
        helpers::find_gguf_tensors(r, &names)
    })
    .await
}

/// The distinct ggml type ids the gguf's tensors use. See
/// [`helpers::read_gguf_tensor_types`] for why this is read rather than
/// inferred from `general.file_type`.
pub async fn read_gguf_tensor_types_internal(path: String) -> Result<Vec<u32>, String> {
    parse_gguf(&path, "GGUF tensor types", |r: &mut (dyn ReadSeek + '_)| {
        helpers::read_gguf_tensor_types(r)
    })
    .await
}

/// Parse a GGUF metadata value that may be either a scalar `u64` or a
/// per-layer bracketed array (`"[0, 0, 4, ...]"` as formatted by `helpers`).
/// Returns one entry per layer when valid and at least one layer is non-zero.
fn parse_per_layer_u64(raw: &str, n_layer: usize) -> Option<Vec<u64>> {
    let trimmed = raw.trim();
    if let Ok(scalar) = trimmed.parse::<u64>() {
        return (scalar > 0).then(|| vec![scalar; n_layer]);
    }
    let inner = trimmed.strip_prefix('[')?.strip_suffix(']')?;
    let values: Option<Vec<u64>> = inner
        .split(',')
        .map(|part| part.trim().parse::<u64>().ok())
        .collect();
    let values = values?;
    if values.len() == n_layer && values.iter().any(|&v| v > 0) {
        Some(values)
    } else {
        None
    }
}

/// Parse a per-layer boolean sliding-window mask (`"[false, ..., true, ...]"`).
fn parse_per_layer_bool(raw: &str, n_layer: usize) -> Option<Vec<bool>> {
    let inner = raw.trim().strip_prefix('[')?.strip_suffix(']')?;
    let values: Option<Vec<bool>> = inner
        .split(',')
        .map(|part| match part.trim() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        })
        .collect();
    let values = values?;
    (values.len() == n_layer).then_some(values)
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
    let n_layer_usize = usize::try_from(n_layer).map_err(|_| KVCacheError::BlockCountInvalid)?;

    // Per-layer KV attention heads (supports both scalar values and hybrid
    // per-layer arrays like LFM2/LFM3 where recurrent/conv layers have 0 KV
    // heads; falls back to full head_count when head_count_kv is absent).
    let n_head_key = format!("{}.attention.head_count", arch);
    let n_head_kv_key = format!("{}.attention.head_count_kv", arch);
    let layer_kv_heads = meta
        .get(&n_head_kv_key)
        .and_then(|s| parse_per_layer_u64(s, n_layer_usize))
        .or_else(|| {
            meta.get(&n_head_key)
                .and_then(|s| parse_per_layer_u64(s, n_layer_usize))
        })
        .ok_or(KVCacheError::HeadCountInvalid)?;

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

        if emb_len > 0 {
            // For most transformers: head_dim = embedding_length / total_heads
            let total_heads = meta
                .get(&n_head_key)
                .and_then(|s| parse_per_layer_u64(s, n_layer_usize))
                .and_then(|v| v.into_iter().max())
                .or_else(|| layer_kv_heads.iter().copied().max())
                .unwrap_or(0);

            if let Some(head_dim) = emb_len.checked_div(total_heads) {
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

    // Sliding window and optional per-layer sliding-window mask
    let sliding_key = format!("{}.attention.sliding_window", arch);
    let sliding_window = meta
        .get(&sliding_key)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0);
    let sliding_pattern_key = format!("{}.attention.sliding_window_pattern", arch);
    let sliding_pattern = meta
        .get(&sliding_pattern_key)
        .and_then(|s| parse_per_layer_bool(s, n_layer_usize));

    // Assume fp16
    const BYTES_PER_ELEMENT: u64 = 2;
    let bytes_per_kv_head_token = key_len
        .saturating_add(val_len)
        .saturating_mul(BYTES_PER_ELEMENT);

    let total_kv_heads: u64 = layer_kv_heads
        .iter()
        .copied()
        .fold(0u64, u64::saturating_add);
    let kv_per_token = total_kv_heads.saturating_mul(bytes_per_kv_head_token);

    let chosen_size = if let (Some(w), Some(pattern)) = (sliding_window, sliding_pattern) {
        let effective_window = ctx_len.min(w);
        let exact =
            layer_kv_heads
                .iter()
                .zip(pattern.iter())
                .fold(0u64, |acc, (&kv_heads, &is_swa)| {
                    let layer_tokens = if is_swa { effective_window } else { ctx_len };
                    let layer_bytes = layer_tokens
                        .saturating_mul(kv_heads)
                        .saturating_mul(bytes_per_kv_head_token);
                    acc.saturating_add(layer_bytes)
                });
        log::info!(
            "KV estimate (per-layer SWA pattern, window={}) -> {} bytes (~{:.2} MB)",
            effective_window,
            exact,
            exact as f64 / (1024.0 * 1024.0)
        );
        exact
    } else if let Some(w) = sliding_window {
        // Middle estimate: average of sliding + full when only scalar
        // sliding_window is declared without a per-layer pattern.
        let full_cost = ctx_len.saturating_mul(kv_per_token);
        let slide = ctx_len.min(w).saturating_mul(kv_per_token);
        let middle = full_cost.saturating_add(slide) / 2;
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
        let full_cost = ctx_len.saturating_mul(kv_per_token);
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

#[cfg(test)]
mod tests {
    use super::*;
    use byteorder::{LittleEndian, WriteBytesExt};
    use std::io::Cursor;

    fn meta(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    fn lfm3_1_7b_meta() -> HashMap<String, String> {
        meta(&[
            ("general.architecture", "lfm3"),
            ("lfm3.block_count", "24"),
            ("lfm3.context_length", "262144"),
            ("lfm3.embedding_length", "2048"),
            ("lfm3.attention.head_count", "16"),
            (
                "lfm3.attention.head_count_kv",
                "[0, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0]",
            ),
            ("lfm3.attention.key_length", "128"),
            ("lfm3.attention.value_length", "128"),
            ("lfm3.attention.sliding_window", "256"),
            (
                "lfm3.attention.sliding_window_pattern",
                "[false, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false]",
            ),
        ])
    }

    #[tokio::test]
    async fn lfm3_hybrid_kv_cache_excludes_conv_layers_and_caps_sliding_layers() {
        // Real LiquidAI/LFM3-1.7B-Q4_K_M.gguf layout:
        // 13 shortconv layers (0 KV heads), 6 full-attention layers (4 KV heads),
        // 5 sliding-attention layers (4 KV heads, window 256), key/val dim 128, fp16.
        let est_32k = estimate_kv_cache_internal(lfm3_1_7b_meta(), Some(32_768))
            .await
            .expect("estimate");
        let per_layer_per_token = 4 * (128 + 128) * 2;
        assert_eq!(est_32k.per_token_size, 11 * per_layer_per_token);
        let expected_32k = (6 * 32_768 + 5 * 256) * per_layer_per_token;
        assert_eq!(est_32k.size, expected_32k);

        // At native 262,144 context: ~3.00 GiB instead of the ~24.02 GiB scalar fallback.
        let est_full = estimate_kv_cache_internal(lfm3_1_7b_meta(), None)
            .await
            .expect("estimate");
        let expected_full = (6 * 262_144 + 5 * 256) * per_layer_per_token;
        assert_eq!(est_full.size, expected_full);
    }

    #[tokio::test]
    async fn hybrid_model_without_sliding_window_counts_only_attention_layers() {
        let m = meta(&[
            ("general.architecture", "lfm2"),
            ("lfm2.block_count", "6"),
            ("lfm2.context_length", "32768"),
            ("lfm2.embedding_length", "2048"),
            ("lfm2.attention.head_count", "32"),
            ("lfm2.attention.head_count_kv", "[0, 0, 8, 0, 0, 8]"),
        ]);
        let est = estimate_kv_cache_internal(m, Some(8_192))
            .await
            .expect("estimate");
        // head_dim = 2048 / 32 = 64, 2 attention layers x 8 KV heads
        let expected_per_token = 2 * 8 * (64 + 64) * 2;
        assert_eq!(est.per_token_size, expected_per_token);
        assert_eq!(est.size, 8_192 * expected_per_token);
    }

    #[tokio::test]
    async fn dense_model_keeps_scalar_kv_cache_formula() {
        let m = meta(&[
            ("general.architecture", "llama"),
            ("llama.block_count", "32"),
            ("llama.context_length", "131072"),
            ("llama.embedding_length", "4096"),
            ("llama.attention.head_count", "32"),
            ("llama.attention.head_count_kv", "8"),
        ]);
        let est = estimate_kv_cache_internal(m, Some(4_096))
            .await
            .expect("estimate");
        let expected_per_token = 32 * 8 * (128 + 128) * 2;
        assert_eq!(est.per_token_size, expected_per_token);
        assert_eq!(est.size, 4_096 * expected_per_token);
    }

    #[tokio::test]
    async fn sliding_window_larger_than_ctx_size_is_clamped_to_ctx_size() {
        let m = meta(&[
            ("general.architecture", "mistral"),
            ("mistral.block_count", "4"),
            ("mistral.context_length", "32768"),
            ("mistral.attention.head_count", "8"),
            ("mistral.attention.head_count_kv", "4"),
            ("mistral.attention.key_length", "64"),
            ("mistral.attention.value_length", "64"),
            ("mistral.attention.sliding_window", "4096"),
        ]);
        let est = estimate_kv_cache_internal(m, Some(1_024))
            .await
            .expect("estimate");
        let per_token = 4 * 4 * (64 + 64) * 2;
        assert_eq!(est.size, 1_024 * per_token);
    }

    #[tokio::test]
    async fn binary_gguf_lfm3_arrays_flow_into_kv_cache_estimate() {
        use crate::gguf::types::GgufValueType;

        let mut b = Vec::new();
        b.extend_from_slice(b"GGUF");
        b.write_u32::<LittleEndian>(3).unwrap();
        b.write_u64::<LittleEndian>(0).unwrap(); // tensor_count
        b.write_u64::<LittleEndian>(9).unwrap(); // metadata_count

        let write_str = |buf: &mut Vec<u8>, s: &str| {
            buf.write_u64::<LittleEndian>(s.len() as u64).unwrap();
            buf.extend_from_slice(s.as_bytes());
        };
        let write_u32_kv = |buf: &mut Vec<u8>, k: &str, v: u32| {
            write_str(buf, k);
            buf.write_u32::<LittleEndian>(GgufValueType::Uint32 as u32)
                .unwrap();
            buf.write_u32::<LittleEndian>(v).unwrap();
        };

        write_str(&mut b, "general.architecture");
        b.write_u32::<LittleEndian>(GgufValueType::String as u32)
            .unwrap();
        write_str(&mut b, "lfm3");

        // 28 layers (> old 24-element skip cap): 7 full, 6 sliding, 15 conv
        let n_layers = 28u32;
        write_u32_kv(&mut b, "lfm3.block_count", n_layers);
        write_u32_kv(&mut b, "lfm3.context_length", 65_536);
        write_u32_kv(&mut b, "lfm3.attention.head_count", 16);
        write_u32_kv(&mut b, "lfm3.attention.key_length", 128);
        write_u32_kv(&mut b, "lfm3.attention.value_length", 128);
        write_u32_kv(&mut b, "lfm3.attention.sliding_window", 256);

        write_str(&mut b, "lfm3.attention.head_count_kv");
        b.write_u32::<LittleEndian>(GgufValueType::Array as u32)
            .unwrap();
        b.write_u32::<LittleEndian>(GgufValueType::Uint32 as u32)
            .unwrap();
        b.write_u64::<LittleEndian>(n_layers as u64).unwrap();
        for i in 0..n_layers {
            let kv = if i % 4 == 2 || (i % 4 == 0 && i > 0) {
                4
            } else {
                0
            };
            b.write_u32::<LittleEndian>(kv).unwrap();
        }

        write_str(&mut b, "lfm3.attention.sliding_window_pattern");
        b.write_u32::<LittleEndian>(GgufValueType::Array as u32)
            .unwrap();
        b.write_u32::<LittleEndian>(GgufValueType::Bool as u32)
            .unwrap();
        b.write_u64::<LittleEndian>(n_layers as u64).unwrap();
        for i in 0..n_layers {
            b.write_u8(u8::from(i % 4 == 0 && i > 0)).unwrap();
        }

        let gguf = helpers::read_gguf_metadata(Cursor::new(b)).expect("parse gguf");
        let est = estimate_kv_cache_internal(gguf.metadata, Some(16_384))
            .await
            .expect("estimate");
        let per_layer_per_token = 4 * (128 + 128) * 2;
        assert_eq!(est.size, (7 * 16_384 + 6 * 256) * per_layer_per_token);
    }
}
