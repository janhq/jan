use super::types::GgufMetadata;
use super::utils::{estimate_kv_cache_internal, read_gguf_metadata_internal};
use crate::gguf::types::{KVCacheError, KVCacheEstimate, ModelSupportStatus};
use std::collections::HashMap;
use std::fs;
use tauri::Runtime;
use tauri_plugin_hardware::get_system_info;
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

#[tauri::command]
pub async fn get_model_size(path: String) -> Result<u64, String> {
    if path.starts_with("https://") {
        // Handle remote URL
        let client = reqwest::Client::new();
        let response = client
            .head(&path)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch HEAD request: {}", e))?;

        if let Some(content_length) = response.headers().get("content-length") {
            let content_length_str = content_length
                .to_str()
                .map_err(|e| format!("Invalid content-length header: {}", e))?;
            content_length_str
                .parse::<u64>()
                .map_err(|e| format!("Failed to parse content-length: {}", e))
        } else {
            Ok(0)
        }
    } else {
        // Handle local file using standard fs
        let metadata =
            fs::metadata(&path).map_err(|e| format!("Failed to get file metadata: {}", e))?;
        Ok(metadata.len())
    }
}

#[tauri::command]
pub async fn is_model_supported<R: Runtime>(
    path: String,
    ctx_size: Option<u32>,
    app_handle: tauri::AppHandle<R>,
) -> Result<ModelSupportStatus, String> {
    // Get model size
    let model_size = get_model_size(path.clone()).await?;

    // Get system info
    let system_info = get_system_info(app_handle.clone());

    log::info!("modelSize: {}", model_size);

    // Read GGUF metadata
    let gguf = read_gguf_metadata(path.clone()).await?;

    // Calculate KV cache size
    let kv_cache_size = if let Some(ctx_size) = ctx_size {
        log::info!("Using ctx_size: {}", ctx_size);
        estimate_kv_cache_internal(gguf.metadata, Some(ctx_size as u64))
            .await
            .map_err(|e| e.to_string())?
            .size
    } else {
        estimate_kv_cache_internal(gguf.metadata, None)
            .await
            .map_err(|e| e.to_string())?
            .size
    };

    // Total memory consumption = model weights + kvcache
    let total_required = model_size + kv_cache_size;
    log::info!(
        "isModelSupported: Total memory requirement: {} for {}; Got kvCacheSize: {} from BE",
        total_required,
        path,
        kv_cache_size
    );

    // Use 90% of total memory as the usable limit
    const USABLE_MEMORY_PERCENTAGE: f64 = 0.9;

    // Calculate total VRAM from all GPUs
    let total_vram: u64 = system_info
        .gpus
        .iter()
        .map(|gpu| gpu.total_memory * 1024 * 1024) // Adjust field name as needed
        .sum();

    let total_system_memory = system_info.total_memory * 1024 * 1024;

    let usable_total_memory = (total_system_memory as f64 * USABLE_MEMORY_PERCENTAGE
        + total_vram as f64 * USABLE_MEMORY_PERCENTAGE) as u64;
    let usable_vram = (total_vram as f64 * USABLE_MEMORY_PERCENTAGE) as u64;

    log::info!("System RAM: {} bytes", &total_system_memory);
    log::info!("Total VRAM: {} bytes", &total_vram);
    log::info!("Usable total memory: {} bytes", &usable_total_memory);
    log::info!("Usable VRAM: {} bytes", &usable_vram);
    log::info!("Required: {} bytes", &total_required);

    // Check if model fits in total memory at all (this is the hard limit)
    if total_required > usable_total_memory {
        return Ok(ModelSupportStatus::Red); // Truly impossible to run
    }

    // Check if everything fits in VRAM (ideal case)
    if total_required <= usable_vram {
        return Ok(ModelSupportStatus::Green);
    }

    // If we get here, it means:
    // - Total requirement fits in combined memory
    // - But doesn't fit entirely in VRAM
    // This is the CPU-GPU hybrid scenario
    Ok(ModelSupportStatus::Yellow)
}
