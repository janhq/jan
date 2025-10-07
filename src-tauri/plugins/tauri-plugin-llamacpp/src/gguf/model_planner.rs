use crate::gguf::commands::get_model_size;
use crate::gguf::utils::estimate_kv_cache_internal;
use crate::gguf::utils::read_gguf_metadata_internal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
pub async fn plan_model_load(
    path: String,
    memory_mode: String,
    mmproj_path: Option<String>,
    requested_ctx: Option<u64>,
) -> Result<ModelPlan, String> {
    let model_size = get_model_size(path.clone()).await?;
    let sys_info = get_system_info();
    let gguf = read_gguf_metadata_internal(path.clone()).await?;

    let mut mmproj_size: u64 = 0;
    if let Some(ref mmproj) = mmproj_path {
        mmproj_size = get_model_size(mmproj.clone()).await?;
    }

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

    const RESERVE_BYTES: u64 = 2288490189;
    const MIN_CONTEXT_LENGTH: u64 = 2048;

    let model_max_ctx: u64 = gguf
        .metadata
        .get(&format!("{arch}.context_length"))
        .and_then(|s| s.parse().ok())
        .unwrap_or(8192);

    let memory_percentages = HashMap::from([("high", 0.7), ("medium", 0.5), ("low", 0.4)]);

    let multiplier = *memory_percentages
        .get(memory_mode.as_str())
        .ok_or("Invalid memory mode")?;

    log::info!("Got GPUs:\n{:?}", &sys_info.gpus);

    let total_ram: u64 = match sys_info.gpus.is_empty() {
        // Consider RAM as 0 for unified memory
        true => 0,
        false => sys_info.total_memory * 1024 * 1024,
    };

    // Calculate total VRAM from all GPUs
    let total_vram: u64 = match sys_info.gpus.is_empty() {
        true => {
            log::info!("No GPUs detected (likely unified memory system), using total RAM as VRAM");
            sys_info.total_memory * 1024 * 1024
        }
        false => sys_info
            .gpus
            .iter()
            .map(|g| g.total_memory * 1024 * 1024)
            .sum::<u64>(),
    };
    log::info!("Total RAM reported/calculated (in bytes): {}", &total_ram);
    log::info!("Total VRAM reported/calculated (in bytes): {}", &total_vram);
    let usable_vram: u64 = if total_vram > RESERVE_BYTES {
        (((total_vram - RESERVE_BYTES) as f64) * multiplier) as u64
    } else {
        0
    };
    log::info!("Usable vram calculated: {}", &usable_vram);

    let usable_ram: u64 = if total_ram > RESERVE_BYTES {
        (((total_ram - RESERVE_BYTES) as f64) * multiplier).max(0.0) as u64
    } else {
        0
    };
    log::info!("Usable ram calculated (in bytes): {}", &usable_ram);

    let mut gpu_layers = 0;
    let mut max_ctx_len = 0;
    let mut no_offload_kv_cache = false;
    let mut mode = ModelMode::Unsupported;
    let mut offload_mmproj = false;
    let mut batch_size = 2048;

    let total_available_mem = usable_vram.saturating_add(usable_ram);
    if model_size + mmproj_size > total_available_mem {
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

    let kv_min_size = estimate_kv_cache_internal(gguf.metadata.clone(), Some(MIN_CONTEXT_LENGTH))
        .await
        .map_err(|e| e.to_string())?
        .size;

    if model_size + kv_min_size + mmproj_size <= usable_vram {
        log::info!("Planning mode: Full GPU offload is possible.");
        mode = ModelMode::GPU;
        gpu_layers = total_layers;
        let vram_left_for_ctx = usable_vram.saturating_sub(model_size);
        let max_ctx_by_vram = (vram_left_for_ctx / kv_cache_per_token) as u64;
        let requested_target = requested_ctx.unwrap_or(model_max_ctx).min(model_max_ctx);
        max_ctx_len = requested_target.min(max_ctx_by_vram);
        no_offload_kv_cache = false;
        offload_mmproj = true;
    } else {
        let mut found_plan = false;

        log::info!("Attempting VRAM-Maximized Hybrid plan (KV cache in VRAM only).");
        for candidate_gpu_layers in (0..=total_layers).rev() {
            let vram_used_by_layers = candidate_gpu_layers.saturating_mul(layer_size);
            if vram_used_by_layers > usable_vram {
                continue;
            }

            let ram_used_by_cpu_layers =
                (total_layers.saturating_sub(candidate_gpu_layers)).saturating_mul(layer_size);
            let ram_used_by_mmproj = if offload_mmproj { 0 } else { mmproj_size };
            let required_ram_for_model = ram_used_by_cpu_layers.saturating_add(ram_used_by_mmproj);

            if required_ram_for_model > usable_ram {
                continue;
            }

            let vram_left_for_kv = usable_vram.saturating_sub(vram_used_by_layers);
            let ctx_in_vram_only = (vram_left_for_kv / kv_cache_per_token) as u64;

            if ctx_in_vram_only >= MIN_CONTEXT_LENGTH {
                log::info!(
                    "Found VRAM-Maximized Hybrid plan with {} GPU layers.",
                    candidate_gpu_layers
                );
                mode = ModelMode::Hybrid;
                gpu_layers = candidate_gpu_layers;
                let requested_target = requested_ctx.unwrap_or(model_max_ctx).min(model_max_ctx);
                max_ctx_len = requested_target.min(ctx_in_vram_only);
                no_offload_kv_cache = false;
                found_plan = true;
                break;
            }
        }

        if !found_plan {
            log::info!("VRAM-Maximized plan not feasible. Falling back to Standard Hybrid (KV cache in VRAM+RAM).");
            for candidate_gpu_layers in (0..=total_layers).rev() {
                let vram_used_by_layers = candidate_gpu_layers.saturating_mul(layer_size);
                if vram_used_by_layers > usable_vram {
                    continue;
                }
                let vram_left_for_kv = usable_vram.saturating_sub(vram_used_by_layers);
                let kv_in_vram = (vram_left_for_kv / kv_cache_per_token) as u64;

                let ram_used_by_cpu_layers =
                    (total_layers.saturating_sub(candidate_gpu_layers)).saturating_mul(layer_size);
                let ram_used_by_mmproj = if offload_mmproj { 0 } else { mmproj_size };
                let required_ram_for_model =
                    ram_used_by_cpu_layers.saturating_add(ram_used_by_mmproj);

                if required_ram_for_model > usable_ram {
                    continue;
                }

                let available_ram_for_kv = usable_ram.saturating_sub(required_ram_for_model);
                let kv_in_ram = (available_ram_for_kv / kv_cache_per_token) as u64;

                let total_kv_tokens = kv_in_vram.saturating_add(kv_in_ram);

                if total_kv_tokens >= MIN_CONTEXT_LENGTH {
                    log::info!(
                        "Found Standard Hybrid plan with {} GPU layers.",
                        candidate_gpu_layers
                    );
                    mode = if candidate_gpu_layers > 0 {
                        ModelMode::Hybrid
                    } else {
                        ModelMode::CPU
                    };
                    gpu_layers = candidate_gpu_layers;
                    let requested_target =
                        requested_ctx.unwrap_or(model_max_ctx).min(model_max_ctx);
                    let max_possible_ctx = total_kv_tokens.min(model_max_ctx);
                    max_ctx_len = requested_target.min(max_possible_ctx);
                    no_offload_kv_cache = kv_in_ram > 0 && kv_in_vram == 0;
                    found_plan = true;
                    break;
                }
            }
        }

        if !found_plan {
            log::info!("No hybrid plan found. Attempting CPU-only plan.");
            if model_size + mmproj_size <= usable_ram {
                let available_ram_for_kv = usable_ram.saturating_sub(model_size + mmproj_size);
                let kv_tokens = (available_ram_for_kv / kv_cache_per_token) as u64;
                if kv_tokens >= MIN_CONTEXT_LENGTH {
                    mode = ModelMode::CPU;
                    gpu_layers = 0;
                    max_ctx_len = kv_tokens
                        .min(requested_ctx.unwrap_or(model_max_ctx))
                        .min(model_max_ctx);
                    no_offload_kv_cache = true;
                    offload_mmproj = false;
                }
            }
        }
    }

    if let Some(req) = requested_ctx {
        if req > 0 {
            max_ctx_len = max_ctx_len.min(req);
        }
    }
    max_ctx_len = max_ctx_len.min(model_max_ctx);

    if max_ctx_len > 0 {
        log::info!("Max context before power-of-2 adjustment: {}", max_ctx_len);
        max_ctx_len = 1u64 << (63 - max_ctx_len.leading_zeros());
        log::info!("Adjusted max context to power of 2: {}", max_ctx_len);
    }

    if mode == ModelMode::Unsupported {
        if max_ctx_len >= MIN_CONTEXT_LENGTH {
            // do nothing, plan is viable but wasn't assigned a mode
        } else {
            gpu_layers = 0;
            max_ctx_len = 0;
            offload_mmproj = false;
        }
    } else if max_ctx_len < MIN_CONTEXT_LENGTH {
        log::info!(
            "Final context length {} is less than minimum required {}. Marking as unsupported.",
            max_ctx_len,
            MIN_CONTEXT_LENGTH
        );
        mode = ModelMode::Unsupported;
        gpu_layers = 0;
        max_ctx_len = 0;
        offload_mmproj = false;
    }

    if mode == ModelMode::Hybrid {
        batch_size = 256;
    } else if mode == ModelMode::CPU || no_offload_kv_cache || mode == ModelMode::Unsupported {
        batch_size = 64;
    }

    if max_ctx_len > 0 {
        batch_size = batch_size.min(max_ctx_len);
    } else {
        batch_size = 64;
    }

    if mode == ModelMode::CPU || no_offload_kv_cache {
        offload_mmproj = false;
    }

    log::info!("Planned model load params: GPU Layers: {}, max_ctx_len: {}, kv_cache offload: {}, offload mmproj: {}, batch_size: {}",
        gpu_layers, max_ctx_len, !no_offload_kv_cache, offload_mmproj, batch_size);
    Ok(ModelPlan {
        gpu_layers,
        max_context_length: max_ctx_len,
        no_offload_kv_cache,
        offload_mmproj,
        batch_size,
        mode,
    })
}
