use super::types::GgufMetadata;
use super::utils::{estimate_kv_cache_internal, read_gguf_metadata_internal};
use crate::gguf::types::{KVCacheError, KVCacheEstimate, ModelSupportStatus};
use std::collections::HashMap;
use std::fs;
use tauri_plugin_hardware::{get_system_info, SystemInfo};

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
pub async fn is_model_supported(
    path: String,
    ctx_size: Option<u32>,
) -> Result<ModelSupportStatus, String> {
    // Get model size
    let model_size = get_model_size(path.clone()).await?;

    // Get system info
    let system_info = get_system_info();

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

    // Apple Silicon: macOS + ARM64 + no discrete GPUs = unified memory.
    // The cpu.arch check guards against Intel Macs with no discrete GPU
    // (x86_64) accidentally taking this path.
    if system_info.os_type == "macos"
        && system_info.cpu.arch == "aarch64"
        && system_info.gpus.is_empty()
    {
        return check_apple_silicon_compatibility(&system_info, total_required);
    }

    const RESERVE_BYTES: u64 = 2_288_490_189; // ~2.13 GB driver/runtime overhead

    let total_system_memory: u64 = match system_info.gpus.is_empty() {
        // No GPU: treat all RAM as the execution pool, no separate system bucket
        true => 0,
        false => system_info.total_memory * 1024 * 1024,
    };

    // Calculate total VRAM from all GPUs
    let total_vram: u64 = match system_info.gpus.is_empty() {
        true => {
            log::info!("No GPUs detected, using total RAM as VRAM");
            system_info.total_memory * 1024 * 1024
        }
        false => system_info
            .gpus
            .iter()
            .map(|g| g.total_memory * 1024 * 1024)
            .sum::<u64>(),
    };

    log::info!("Total VRAM reported/calculated (in bytes): {}", &total_vram);

    let usable_vram = if total_vram > RESERVE_BYTES {
        total_vram - RESERVE_BYTES
    } else {
        0
    };

    let usable_total_memory = if total_system_memory > RESERVE_BYTES {
        (total_system_memory - RESERVE_BYTES) + usable_vram
    } else {
        usable_vram
    };
    log::info!("System RAM: {} bytes", &total_system_memory);
    log::info!("Total VRAM: {} bytes", &total_vram);
    log::info!("Usable total memory: {} bytes", &usable_total_memory);
    log::info!("Usable VRAM: {} bytes", &usable_vram);
    log::info!("Required: {} bytes", &total_required);

    // Check if model fits in total memory at all (this is the hard limit)
    if total_required > usable_total_memory {
        return Ok(ModelSupportStatus::Red); // Truly impossible to run
    }

    // Check if everything fits in VRAM (ideal case — pure GPU execution)
    if total_required <= usable_vram {
        return Ok(ModelSupportStatus::Green);
    }

    // Fits in combined RAM+VRAM but not entirely in VRAM: CPU-GPU hybrid scenario
    Ok(ModelSupportStatus::Yellow)
}

/// Compatibility check for Apple Silicon Macs (unified memory architecture).
///
/// On Apple Silicon, CPU and GPU share a single physical memory pool. Unlike
/// discrete-GPU systems, there is no separate VRAM — the entire pool is used
/// by the OS, Metal GPU runtime, system daemons, AND the model simultaneously.
///
/// The OS overhead is larger and more variable than the fixed 2.13 GB constant
/// used for discrete-GPU systems:
///
///   Fixed component (~2.5 GB):
///     macOS kernel, Spotlight, WindowServer, system daemons, Metal runtime init.
///
///   Variable component (~10% of total pool):
///     Metal GPU wired memory and driver state, which scales with pool size
///     because larger pools allow larger GPU-resident textures and command buffers.
///
/// Observed usable memory on real hardware:
///    8 GB  → ~4.7 GB usable  (41% overhead — OS is proportionally huge on small configs)
///   16 GB  → ~11.9 GB usable (26% overhead)
///   32 GB  → ~26.3 GB usable (18% overhead)
///   64 GB  → ~53.7 GB usable (16% overhead)
///
/// Status mapping:
///   GREEN  — fits with ≥15% spare usable memory; full Metal GPU throughput expected.
///   YELLOW — fits but tight; memory pressure may cause inference slowdowns.
///   RED    — exceeds usable memory; macOS will swap to disk or the process will crash.
fn check_apple_silicon_compatibility(
    system_info: &SystemInfo,
    total_required: u64,
) -> Result<ModelSupportStatus, String> {
    let total_bytes = system_info.total_memory * 1024 * 1024;

    // 2.5 GB: fixed baseline consumed by macOS kernel, daemons, Metal runtime
    const FIXED_OVERHEAD: u64 = 2_684_354_560;
    // 10%: Metal GPU wired memory + driver state, proportional to pool size
    const VARIABLE_OVERHEAD_RATIO: f64 = 0.10;

    let variable_overhead = (total_bytes as f64 * VARIABLE_OVERHEAD_RATIO) as u64;
    let usable = total_bytes.saturating_sub(FIXED_OVERHEAD + variable_overhead);

    log::info!(
        "Apple Silicon: total={} B, fixed_overhead={} B, variable_overhead={} B, \
         usable={} B, required={} B",
        total_bytes,
        FIXED_OVERHEAD,
        variable_overhead,
        usable,
        total_required
    );

    // RED: model exceeds available unified memory — will page to disk or crash
    if total_required > usable {
        return Ok(ModelSupportStatus::Red);
    }

    // GREEN vs YELLOW: use an 85% threshold so that models leaving <15% headroom
    // are flagged as YELLOW, warning the user about potential memory pressure
    // during long inference sessions or with large context windows.
    const COMFORTABLE_RATIO: f64 = 0.85;
    let comfortable_threshold = (usable as f64 * COMFORTABLE_RATIO) as u64;

    if total_required <= comfortable_threshold {
        Ok(ModelSupportStatus::Green)
    } else {
        Ok(ModelSupportStatus::Yellow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_hardware::{CpuStaticInfo, SystemInfo};

    fn apple_silicon(total_memory_mib: u64) -> SystemInfo {
        SystemInfo {
            cpu: CpuStaticInfo {
                name: "Apple M2".to_string(),
                core_count: 8,
                arch: "aarch64".to_string(),
                extensions: vec![],
            },
            os_type: "macos".to_string(),
            os_name: "macOS 14.0".to_string(),
            total_memory: total_memory_mib,
            gpus: vec![],
        }
    }

    // Computed thresholds (verified by hand):
    //
    //  8 GB (8192 MiB):
    //    total   = 8,589,934,592 B
    //    usable  = 8,589,934,592 - (2,684,354,560 + 858,993,459)  = 5,046,586,573 B (~4.70 GB)
    //    comfy   = 5,046,586,573 * 0.85                           = 4,289,598,586 B (~3.99 GB)
    //
    // 16 GB (16384 MiB):
    //    total   = 17,179,869,184 B
    //    usable  = 17,179,869,184 - (2,684,354,560 + 1,717,986,918) = 12,777,527,706 B (~11.90 GB)
    //    comfy   = 12,777,527,706 * 0.85                            = 10,860,898,550 B (~10.11 GB)
    //
    // 32 GB (32768 MiB):
    //    total   = 34,359,738,368 B
    //    usable  = 34,359,738,368 - (2,684,354,560 + 3,435,973,836) = 28,239,409,972 B (~26.31 GB)
    //    comfy   = 28,239,409,972 * 0.85                             = 24,003,498,476 B (~22.35 GB)

    // --- 8 GB Mac ---

    #[test]
    fn test_8gb_mac_small_model_is_green() {
        // ~1.7 GB — comfortably below comfy threshold (~4.0 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(8 * 1024), 1_825_361_100).unwrap(),
            ModelSupportStatus::Green
        );
    }

    #[test]
    fn test_8gb_mac_tight_model_is_yellow() {
        // ~4.4 GB — above comfy (4.29 GB) but below usable (4.70 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(8 * 1024), 4_724_464_025).unwrap(),
            ModelSupportStatus::Yellow
        );
    }

    #[test]
    fn test_8gb_mac_large_model_is_red() {
        // 5 GB — exceeds usable (~4.70 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(8 * 1024), 5_368_709_120).unwrap(),
            ModelSupportStatus::Red
        );
    }

    // --- 16 GB Mac ---

    #[test]
    fn test_16gb_mac_7b_model_is_green() {
        // ~4.1 GB — well within comfy threshold (~10.1 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(16 * 1024), 4_402_341_478).unwrap(),
            ModelSupportStatus::Green
        );
    }

    #[test]
    fn test_16gb_mac_13b_model_is_green() {
        // ~7.4 GB — within comfy threshold (~10.1 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(16 * 1024), 7_945_689_497).unwrap(),
            ModelSupportStatus::Green
        );
    }

    #[test]
    fn test_16gb_mac_tight_model_is_yellow() {
        // 11 GB — above comfy (10.86 GB) but below usable (11.90 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(16 * 1024), 11_811_160_064).unwrap(),
            ModelSupportStatus::Yellow
        );
    }

    #[test]
    fn test_16gb_mac_20b_model_is_red() {
        // 13 GB — exceeds usable (11.90 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(16 * 1024), 13_958_643_712).unwrap(),
            ModelSupportStatus::Red
        );
    }

    // --- 32 GB Mac ---

    #[test]
    fn test_32gb_mac_20b_model_is_green() {
        // 12 GB — well within comfy threshold (~22.4 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(32 * 1024), 12_884_901_888).unwrap(),
            ModelSupportStatus::Green
        );
    }

    #[test]
    fn test_32gb_mac_tight_model_is_yellow() {
        // 25 GB — above comfy (22.35 GB) but below usable (26.31 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(32 * 1024), 26_843_545_600).unwrap(),
            ModelSupportStatus::Yellow
        );
    }

    #[test]
    fn test_32gb_mac_oversized_model_is_red() {
        // 30 GB — exceeds usable (~26.3 GB)
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(32 * 1024), 32_212_254_720).unwrap(),
            ModelSupportStatus::Red
        );
    }

    // --- Boundary conditions ---

    #[test]
    fn test_zero_required_is_green() {
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(16 * 1024), 0).unwrap(),
            ModelSupportStatus::Green
        );
    }

    #[test]
    fn test_exactly_at_usable_boundary_is_yellow() {
        // required == usable: fits but no headroom → YELLOW, not RED
        let usable: u64 = 12_777_527_706;
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(16 * 1024), usable).unwrap(),
            ModelSupportStatus::Yellow
        );
    }

    #[test]
    fn test_one_byte_over_usable_is_red() {
        let usable: u64 = 12_777_527_706;
        assert_eq!(
            check_apple_silicon_compatibility(&apple_silicon(16 * 1024), usable + 1).unwrap(),
            ModelSupportStatus::Red
        );
    }
}
