use crate::gguf::commands::get_model_size;
use crate::gguf::utils::estimate_kv_cache_internal;
use crate::gguf::utils::read_gguf_metadata_internal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Runtime;
use tauri_plugin_hardware::get_system_info;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelPlan {
    pub gpu_layers: u64,
    pub max_context_length: u64,
    pub no_offload_kv_cache: bool,
    pub offload_mmproj: bool,
    pub batch_size: u64,
    pub mode: ModelMode,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum ModelMode {
    GPU,
    Hybrid,
    CPU,
    Unsupported,
}

#[tauri::command]
pub async fn plan_model_load<R: Runtime>(
    path: String,
    memory_mode: String, // "high", "medium", or "low"
    mmproj_path: Option<String>,
    requested_ctx: Option<u64>,
    app: tauri::AppHandle<R>,
) -> Result<ModelPlan, String> {
    let model_size = get_model_size(path.clone()).await?;
    let sys_info = get_system_info(app.clone());
    let gguf = read_gguf_metadata_internal(path.clone()).await?;

    // mmproj size
    let mut mmproj_size: u64 = 0;
    if let Some(ref mmproj) = mmproj_path {
        mmproj_size = get_model_size(mmproj.clone()).await?;
    }

    // getLayerSize equivalent: derive from metadata
    let arch = gguf
        .metadata
        .get("general.architecture")
        .ok_or("Missing architecture")?;
    let repeating_layers: u64 = gguf
        .metadata
        .get(&format!("{arch}.block_count"))
        .ok_or("Missing block_count")?
        .parse()
        .map_err(|_| "Invalid block_count")?;
    let total_layers = repeating_layers + 1;
    let layer_size = model_size / total_layers;

    let kv_cache = estimate_kv_cache_internal(gguf.metadata.clone(), None)
        .await
        .map_err(|e| e.to_string())?;
    let kv_cache_per_token = kv_cache.per_token_size;

    if model_size == 0 || layer_size == 0 || kv_cache_per_token == 0 {
        return Err("Invalid model/layer/cache sizes".into());
    }

    // Constants
    let vram_reserve_bytes = (0.5 * 1024f64 * 1024f64 * 1024f64) as u64;
    let engine_fixed_overhead = (0.2 * 1024f64 * 1024f64 * 1024f64) as u64;
    let min_context_length = 1024;

    let model_max_ctx: u64 = gguf
        .metadata
        .get(&format!("{arch}.context_length"))
        .and_then(|s| s.parse().ok())
        .unwrap_or(8192);

    let memory_percentages = HashMap::from([("high", 0.7), ("medium", 0.5), ("low", 0.4)]);

    let multiplier = *memory_percentages
        .get(memory_mode.as_str())
        .ok_or("Invalid memory mode")?;

    // GPU VRAM (MB -> bytes)
    let total_vram: u64 = sys_info.gpus.iter().map(|g| g.total_memory).sum::<u64>() * 1024 * 1024;
    log::info!(
        "Total VRAM reported from tauri_plugin_hardware(in bytes): {}",
        &total_vram
    );
    let usable_vram: u64 = ((total_vram as f64) * multiplier
        - vram_reserve_bytes as f64
        - engine_fixed_overhead as f64)
        .max(0.0) as u64;
    log::info!("Usable vram calculated: {}", &usable_vram);

    // System RAM (MB -> bytes)
    let total_ram: u64 = sys_info.total_memory * 1024 * 1024;
    log::info!(
        "Total system memory reported from tauri_plugin_hardware(in bytes): {}",
        &total_ram
    );
    let usable_ram: u64 = ((total_ram as f64) * multiplier).max(0.0) as u64;
    log::info!("Usable ram calculated (in bytes): {}", &usable_ram);

    let mut gpu_layers = 0;
    let mut max_ctx_len = 0;
    let mut no_offload_kv_cache = false;
    let mut mode = ModelMode::Unsupported;
    let mut offload_mmproj = false;
    let mut batch_size = 2048;

    // quick sanity
    let total_available_mem = usable_vram.saturating_add(usable_ram);
    if model_size + mmproj_size > total_available_mem {
        // model + mmproj cannot fit anywhere -> unsupported
        log::info!("Model not supported in this system!");
        return Ok(ModelPlan {
            gpu_layers: 0,
            max_context_length: 0,
            no_offload_kv_cache: true,
            batch_size: 64,
            mode: ModelMode::Unsupported,
            offload_mmproj: false,
        });
    }
    if mmproj_size > 0 {
        offload_mmproj = true;
    }

    // precompute sizes for minimum ctx
    let kv_min_size = estimate_kv_cache_internal(gguf.metadata.clone(), Some(min_context_length))
        .await
        .map_err(|e| e.to_string())?
        .size;

    // Try full-GPU first (fast path)
    if model_size + kv_min_size + mmproj_size <= usable_vram {
        // Entire model + min-kv + mmproj_size fits inside VRAM -> give GPU mode
        mode = ModelMode::GPU;
        gpu_layers = total_layers;
        // try to provide requested ctx (bounded to what VRAM allows)
        let vram_left_for_ctx = usable_vram.saturating_sub(model_size);
        let max_ctx_by_vram = (vram_left_for_ctx / kv_cache_per_token) as u64;
        // use target_ctx when possible, otherwise the maximum VRAM allows, not exceeding model_max_ctx
        let requested_target = requested_ctx.unwrap_or(model_max_ctx).min(model_max_ctx);
        max_ctx_len = requested_target.min(max_ctx_by_vram);
        no_offload_kv_cache = false;
        offload_mmproj = true;
    } else {
        // Try hybrid by iterating gpu_layers from maximum down to 0.
        // We select the highest gpu_layers that allows at least min_context_length
        // worth of kvcache split between VRAM and RAM.
        let mut found_hybrid = false;
        // We'll prefer configurations that keep as many layers in GPU as possible.
        for candidate_gpu_layers in (0..=total_layers).rev() {
            // vram occupied by GPU layers
            let vram_used_by_layers = candidate_gpu_layers.saturating_mul(layer_size);
            if vram_used_by_layers > usable_vram {
                // not enough VRAM to hold these many layers
                continue;
            }
            // VRAM left for kvcache (we already reserved mmproj earlier by reducing remaining_vram)
            let vram_left_for_kv = usable_vram.saturating_sub(vram_used_by_layers);
            let kv_in_vram = (vram_left_for_kv / kv_cache_per_token) as u64;

            // RAM required to hold the CPU-side layers + (mmproj if not in VRAM)
            let ram_used_by_cpu_layers =
                (total_layers.saturating_sub(candidate_gpu_layers)).saturating_mul(layer_size);
            let ram_used_by_mmproj = if offload_mmproj { 0 } else { mmproj_size };
            let required_ram_for_model = ram_used_by_cpu_layers
                .saturating_add(model_size)
                .saturating_add(ram_used_by_mmproj);

            if required_ram_for_model > usable_ram {
                // not enough RAM to hold the CPU-side of the model for this candidate
                continue;
            }

            // RAM available for kvcache after model placement
            let available_ram_for_kv = usable_ram.saturating_sub(required_ram_for_model);
            let kv_in_ram = (available_ram_for_kv / kv_cache_per_token) as u64;

            // total kv tokens we can support with this split
            let total_kv_tokens = kv_in_vram.saturating_add(kv_in_ram);

            if total_kv_tokens >= min_context_length {
                // feasible hybrid configuration found
                mode = if candidate_gpu_layers == total_layers {
                    ModelMode::GPU
                } else if candidate_gpu_layers == 0 {
                    // no layers in GPU (but kvcache may be in RAM/VRAM) -> treat as Hybrid if kv_in_vram>0 else CPU
                    if kv_in_vram > 0 {
                        ModelMode::Hybrid
                    } else {
                        ModelMode::CPU
                    }
                } else {
                    ModelMode::Hybrid
                };

                gpu_layers = candidate_gpu_layers;
                // compute a realistic max_ctx_len given resource distribution, also cap to model_max_ctx and requested_ctx
                let requested_target = requested_ctx.unwrap_or(model_max_ctx).min(model_max_ctx);
                // compute total ctx tokens allowed by vram and ram for kv
                let vram_ctx_tokens = kv_in_vram;
                let ram_ctx_tokens = kv_in_ram;
                let max_possible_ctx = (vram_ctx_tokens + ram_ctx_tokens).min(model_max_ctx);
                max_ctx_len = requested_target.min(max_possible_ctx);

                // If any kv lives in RAM, we must ensure offload behavior for kvcache is true
                no_offload_kv_cache = kv_in_vram == 0; // if no kv in VRAM, then kv must be in RAM -> "no_offload_kv_cache" meaning don't offload kvcache to GPU

                found_hybrid = true;
                break;
            }
        }

        if !found_hybrid {
            // Try CPU-only placement: model + mmproj in RAM and kvcache also in RAM
            if model_size + mmproj_size <= usable_ram {
                let available_ram_for_kv = usable_ram.saturating_sub(model_size + mmproj_size);
                let kv_tokens = (available_ram_for_kv / kv_cache_per_token) as u64;
                if kv_tokens >= min_context_length {
                    mode = ModelMode::CPU;
                    gpu_layers = 0;
                    max_ctx_len = kv_tokens
                        .min(requested_ctx.unwrap_or(model_max_ctx))
                        .min(model_max_ctx);
                    no_offload_kv_cache = true; // kvcache in RAM
                                                // when CPU mode, mmproj must be in RAM
                    offload_mmproj = false;
                } else {
                    // cannot meet minimum context in any config
                    mode = ModelMode::Unsupported;
                    gpu_layers = 0;
                    max_ctx_len = 0;
                    no_offload_kv_cache = true;
                    offload_mmproj = false;
                }
            } else {
                // model + mmproj doesn't fit fully in RAM (and hybrid failed earlier) -> try partial fallback:
                // attempt to find any gpu_layers >0 that let us fit model (even if min ctx can't be satisfied)
                let possible_gpu_layers = usable_vram / layer_size;
                if possible_gpu_layers > 0 {
                    gpu_layers = possible_gpu_layers.min(total_layers);
                    // RAM used by the remaining layers and mmproj
                    let ram_used_by_cpu_layers =
                        (total_layers.saturating_sub(gpu_layers)).saturating_mul(layer_size);
                    let ram_used_by_mmproj = if offload_mmproj { 0 } else { mmproj_size };
                    let available_ram_for_kv =
                        usable_ram.saturating_sub(ram_used_by_cpu_layers + ram_used_by_mmproj);
                    let ctx_in_ram = (available_ram_for_kv / kv_cache_per_token) as u64;
                    if ctx_in_ram >= min_context_length {
                        mode = ModelMode::Hybrid;
                        max_ctx_len = ctx_in_ram
                            .min(requested_ctx.unwrap_or(model_max_ctx))
                            .min(model_max_ctx);
                        no_offload_kv_cache = true;
                    } else {
                        // still not enough
                        mode = ModelMode::Unsupported;
                        gpu_layers = 0;
                        max_ctx_len = 0;
                    }
                } else {
                    mode = ModelMode::Unsupported;
                    gpu_layers = 0;
                    max_ctx_len = 0;
                }
            }
        }
    }

    // batch size adjustments
    if mode == ModelMode::Hybrid {
        batch_size = 256;
    } else if mode == ModelMode::CPU || no_offload_kv_cache {
        batch_size = 64;
    }

    // if CPU or kvcache is forced to RAM, ensure mmproj not flagged as offloaded to VRAM
    if mode == ModelMode::CPU || no_offload_kv_cache {
        offload_mmproj = false;
    }

    // final clamp to model_max_ctx and requested_ctx
    if let Some(req) = requested_ctx {
        if req > 0 {
            max_ctx_len = max_ctx_len.min(req);
        }
    }
    max_ctx_len = max_ctx_len.min(model_max_ctx);

    // if after all attempts we still don't have min_context_length, mark Unsupported
    if mode != ModelMode::Unsupported && max_ctx_len < min_context_length {
        mode = ModelMode::Unsupported;
        gpu_layers = 0;
        max_ctx_len = 0;
        offload_mmproj = false;
    }
    log::info!("Planned model load params: GPU Layers: {}, max_ctx_len: {}, kv_cache offload: {}, offload mmproj: {}, batch_size: {}",
        gpu_layers, max_ctx_len, no_offload_kv_cache, offload_mmproj, batch_size);
    Ok(ModelPlan {
        gpu_layers,
        max_context_length: max_ctx_len,
        no_offload_kv_cache,
        offload_mmproj,
        batch_size,
        mode,
    })
}
