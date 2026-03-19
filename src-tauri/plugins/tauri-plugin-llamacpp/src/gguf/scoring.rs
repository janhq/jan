use super::types::{
    GgufMetadata, HubModelScoreRequest, HubModelScoreResult, ModelScoreBreakdown, ModelScoreStatus,
    ModelSupportStatus,
};
use super::utils::{estimate_kv_cache_internal, read_gguf_metadata_internal};
use crate::gguf::commands::get_model_size;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};
use tauri_plugin_hardware::{get_system_info, SystemInfo};

const SCORE_CACHE_SCHEMA_VERSION: &str = "v1";
const SCORE_CACHE_FILE: &str = "llmfit_hub_scores.json";
const DEFAULT_CTX_SIZE: u32 = 8192;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedScoreEntry {
    result: HubModelScoreResult,
}

type ScoreCache = HashMap<String, CachedScoreEntry>;

#[derive(Debug, Clone)]
struct ExplicitModelDefinition {
    architecture: String,
    context_length: u64,
    parameter_billions: Option<f32>,
    quant_tier: f32,
}

pub async fn score_hub_model_internal<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: HubModelScoreRequest,
) -> Result<HubModelScoreResult, String> {
    let system_info = get_system_info();
    let hardware_fingerprint = build_hardware_fingerprint(&system_info);
    let cache_key = build_cache_key(&request, &hardware_fingerprint);

    if let Some(cached) = read_cache_entry(&app_handle, &cache_key)? {
        return Ok(cached);
    }

    let updated_at = current_unix_timestamp();

    let score_result = match compute_score_result(&request, &system_info).await {
        Ok((overall, breakdown, used_builtin_fallback)) => HubModelScoreResult {
            status: ModelScoreStatus::Ready,
            overall: Some(overall),
            breakdown: Some(breakdown),
            scored_quant_model_id: request.default_quant_model_id.clone(),
            hardware_fingerprint,
            cache_key: cache_key.clone(),
            updated_at,
            used_builtin_fallback,
            reason: None,
        },
        Err(reason) => HubModelScoreResult {
            status: ModelScoreStatus::Unavailable,
            overall: None,
            breakdown: None,
            scored_quant_model_id: request.default_quant_model_id.clone(),
            hardware_fingerprint,
            cache_key: cache_key.clone(),
            updated_at,
            used_builtin_fallback: false,
            reason: Some(reason),
        },
    };

    write_cache_entry(&app_handle, &cache_key, score_result.clone())?;
    Ok(score_result)
}

async fn compute_score_result(
    request: &HubModelScoreRequest,
    system_info: &SystemInfo,
) -> Result<(f32, ModelScoreBreakdown, bool), String> {
    let gguf = read_gguf_metadata_internal(request.model_path.clone()).await?;
    let model_size = get_model_size(request.model_path.clone()).await?;
    let support = estimate_support_status(&gguf, model_size, request.ctx_size, system_info).await?;

    if let Some(definition) = build_explicit_definition(request, &gguf) {
        let breakdown = score_from_definition(&definition, &support);
        let overall = compute_overall_score(&breakdown);
        return Ok((overall, breakdown, false));
    }

    if let Some(breakdown) = score_from_builtin_catalog(request, &gguf, &support) {
        let overall = compute_overall_score(&breakdown);
        return Ok((overall, breakdown, true));
    }

    Err("No conservative score mapping available for this model".to_string())
}

fn build_explicit_definition(
    request: &HubModelScoreRequest,
    gguf: &GgufMetadata,
) -> Option<ExplicitModelDefinition> {
    let architecture = gguf.metadata.get("general.architecture")?.to_string();
    let context_length = gguf
        .metadata
        .get(&format!("{}.context_length", architecture))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)?;

    Some(ExplicitModelDefinition {
        architecture,
        context_length,
        parameter_billions: infer_parameter_billions(request, gguf),
        quant_tier: infer_quant_tier(&request.default_quant_model_id),
    })
}

fn infer_parameter_billions(
    request: &HubModelScoreRequest,
    gguf: &GgufMetadata,
) -> Option<f32> {
    let candidates = [
        request.default_quant_model_id.as_str(),
        request.model_name.as_str(),
        gguf.metadata
            .get("general.name")
            .map(String::as_str)
            .unwrap_or_default(),
    ];

    for candidate in candidates {
        if let Some(value) = parse_billions_from_text(candidate) {
            return Some(value);
        }
    }

    None
}

fn parse_billions_from_text(input: &str) -> Option<f32> {
    let lower = input.to_lowercase();
    let bytes = lower.as_bytes();

    for index in 0..bytes.len() {
        if !(bytes[index].is_ascii_digit()) {
            continue;
        }

        let mut end = index;
        while end < bytes.len() && (bytes[end].is_ascii_digit() || bytes[end] == b'.') {
            end += 1;
        }

        if end >= bytes.len() {
            continue;
        }

        if bytes[end] == b'b' {
            if let Ok(value) = lower[index..end].parse::<f32>() {
                return Some(value);
            }
        }
    }

    None
}

fn infer_quant_tier(model_id: &str) -> f32 {
    let lower = model_id.to_lowercase();
    if lower.contains("q8") {
        1.0
    } else if lower.contains("q6") {
        0.92
    } else if lower.contains("q5") {
        0.86
    } else if lower.contains("q4") || lower.contains("iq4") {
        0.76
    } else if lower.contains("q3") || lower.contains("iq3") {
        0.64
    } else if lower.contains("q2") || lower.contains("iq2") {
        0.5
    } else {
        0.7
    }
}

fn score_from_definition(
    definition: &ExplicitModelDefinition,
    support: &ModelSupportStatus,
) -> ModelScoreBreakdown {
    let parameter_score = definition
        .parameter_billions
        .map(score_parameters)
        .unwrap_or(58.0);
    let quality = clamp_score(parameter_score * definition.quant_tier);
    let speed = clamp_score(score_speed(definition.parameter_billions, support));
    let fit = clamp_score(score_fit(support));
    let context = clamp_score(score_context(definition.context_length));

    ModelScoreBreakdown {
        quality,
        speed,
        fit,
        context,
    }
}

fn score_from_builtin_catalog(
    request: &HubModelScoreRequest,
    gguf: &GgufMetadata,
    support: &ModelSupportStatus,
) -> Option<ModelScoreBreakdown> {
    let normalized = format!(
        "{}/{}",
        request.developer.clone().unwrap_or_default().to_lowercase(),
        request.model_name.to_lowercase()
    );

    let family_quality = if normalized.contains("janhq/jan") || normalized.contains("jan-v") {
        Some(74.0)
    } else if normalized.contains("qwen") {
        Some(82.0)
    } else if normalized.contains("llama") {
        Some(80.0)
    } else if normalized.contains("gemma") {
        Some(76.0)
    } else if normalized.contains("mistral") {
        Some(78.0)
    } else if normalized.contains("phi") {
        Some(70.0)
    } else if normalized.contains("deepseek") {
        Some(81.0)
    } else {
        None
    }?;

    let quant_tier = infer_quant_tier(&request.default_quant_model_id);
    let context_length = gguf
        .metadata
        .get("general.architecture")
        .and_then(|arch| gguf.metadata.get(&format!("{}.context_length", arch)))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(8192);

    Some(ModelScoreBreakdown {
        quality: clamp_score(family_quality * quant_tier),
        speed: clamp_score(score_speed(
            infer_parameter_billions(request, gguf),
            support,
        )),
        fit: clamp_score(score_fit(support)),
        context: clamp_score(score_context(context_length)),
    })
}

fn score_parameters(parameters: f32) -> f32 {
    match parameters {
        p if p >= 70.0 => 96.0,
        p if p >= 32.0 => 90.0,
        p if p >= 14.0 => 84.0,
        p if p >= 8.0 => 78.0,
        p if p >= 4.0 => 70.0,
        p if p >= 2.0 => 60.0,
        _ => 52.0,
    }
}

fn score_speed(parameters: Option<f32>, support: &ModelSupportStatus) -> f32 {
    let base = match parameters {
        Some(p) if p >= 32.0 => 42.0,
        Some(p) if p >= 14.0 => 50.0,
        Some(p) if p >= 8.0 => 60.0,
        Some(p) if p >= 4.0 => 72.0,
        Some(p) if p >= 2.0 => 82.0,
        Some(_) => 88.0,
        None => 66.0,
    };

    match support {
        ModelSupportStatus::Green => base + 8.0,
        ModelSupportStatus::Yellow => base,
        ModelSupportStatus::Red => 20.0,
    }
}

fn score_fit(support: &ModelSupportStatus) -> f32 {
    match support {
        ModelSupportStatus::Green => 96.0,
        ModelSupportStatus::Yellow => 72.0,
        ModelSupportStatus::Red => 15.0,
    }
}

fn score_context(context_length: u64) -> f32 {
    match context_length {
        c if c >= 128_000 => 98.0,
        c if c >= 64_000 => 92.0,
        c if c >= 32_000 => 84.0,
        c if c >= 16_000 => 76.0,
        c if c >= 8_000 => 66.0,
        _ => 54.0,
    }
}

fn compute_overall_score(breakdown: &ModelScoreBreakdown) -> f32 {
    clamp_score(
        (breakdown.quality * 0.4)
            + (breakdown.speed * 0.2)
            + (breakdown.fit * 0.25)
            + (breakdown.context * 0.15),
    )
}

fn clamp_score(value: f32) -> f32 {
    (value.clamp(0.0, 100.0) * 10.0).round() / 10.0
}

async fn estimate_support_status(
    gguf: &GgufMetadata,
    model_size: u64,
    ctx_size: Option<u32>,
    system_info: &SystemInfo,
) -> Result<ModelSupportStatus, String> {
    let kv_cache_size = estimate_kv_cache_internal(
        gguf.metadata.clone(),
        Some(ctx_size.unwrap_or(DEFAULT_CTX_SIZE) as u64),
    )
    .await
    .map_err(|error| error.to_string())?
    .size;

    let total_required = model_size + kv_cache_size;
    const RESERVE_BYTES: u64 = 2_288_490_189;

    let total_system_memory: u64 = if system_info.gpus.is_empty() {
        0
    } else {
        system_info.total_memory * 1024 * 1024
    };

    let total_vram: u64 = if system_info.gpus.is_empty() {
        system_info.total_memory * 1024 * 1024
    } else {
        system_info
            .gpus
            .iter()
            .map(|gpu| gpu.total_memory * 1024 * 1024)
            .sum()
    };

    let usable_vram = total_vram.saturating_sub(RESERVE_BYTES);
    let usable_total_memory = usable_vram + total_system_memory.saturating_sub(RESERVE_BYTES);

    if total_required > usable_total_memory {
        return Ok(ModelSupportStatus::Red);
    }

    if total_required <= usable_vram {
        return Ok(ModelSupportStatus::Green);
    }

    Ok(ModelSupportStatus::Yellow)
}

fn build_hardware_fingerprint(system_info: &SystemInfo) -> String {
    let mut hasher = Sha256::new();
    hasher.update(system_info.os_type.as_bytes());
    hasher.update(system_info.os_name.as_bytes());
    hasher.update(system_info.cpu.name.as_bytes());
    hasher.update(system_info.cpu.arch.as_bytes());
    hasher.update(system_info.cpu.core_count.to_le_bytes());
    hasher.update(system_info.total_memory.to_le_bytes());

    for extension in &system_info.cpu.extensions {
        hasher.update(extension.as_bytes());
    }

    for gpu in &system_info.gpus {
        hasher.update(gpu.name.as_bytes());
        hasher.update(gpu.uuid.as_bytes());
        hasher.update(gpu.total_memory.to_le_bytes());
        hasher.update(gpu.driver_version.as_bytes());
    }

    hex_string(hasher.finalize().as_slice())
}

fn build_cache_key(request: &HubModelScoreRequest, hardware_fingerprint: &str) -> String {
    let raw = format!(
        "{}|{}|{}|{}|{}",
        SCORE_CACHE_SCHEMA_VERSION,
        request.default_quant_model_id,
        request.model_path,
        request.ctx_size.unwrap_or(DEFAULT_CTX_SIZE),
        hardware_fingerprint
    );

    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex_string(hasher.finalize().as_slice())
}

fn read_cache_entry<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    cache_key: &str,
) -> Result<Option<HubModelScoreResult>, String> {
    let cache = read_cache(app_handle)?;
    Ok(cache.get(cache_key).map(|entry| entry.result.clone()))
}

fn write_cache_entry<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    cache_key: &str,
    result: HubModelScoreResult,
) -> Result<(), String> {
    let mut cache = read_cache(app_handle)?;
    cache.insert(cache_key.to_string(), CachedScoreEntry { result });
    write_cache(app_handle, &cache)
}

fn read_cache<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Result<ScoreCache, String> {
    let cache_path = cache_path(app_handle)?;
    if !cache_path.exists() {
        return Ok(HashMap::new());
    }

    let content =
        fs::read_to_string(&cache_path).map_err(|error| format!("Failed to read cache: {error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("Failed to parse cache: {error}"))
}

fn write_cache<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    cache: &ScoreCache,
) -> Result<(), String> {
    let cache_path = cache_path(app_handle)?;
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create cache directory: {error}"))?;
    }

    let content =
        serde_json::to_string_pretty(cache).map_err(|error| format!("Failed to serialize cache: {error}"))?;
    fs::write(cache_path, content).map_err(|error| format!("Failed to write cache: {error}"))
}

fn cache_path<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    Ok(app_data_dir.join("llamacpp").join(SCORE_CACHE_FILE))
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn hex_string(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_hardware::{CpuStaticInfo, GpuInfo, SystemInfo, Vendor};

    fn mock_system_info() -> SystemInfo {
        SystemInfo {
            cpu: CpuStaticInfo {
                name: "Test CPU".to_string(),
                core_count: 8,
                arch: "x86_64".to_string(),
                extensions: vec!["avx2".to_string()],
            },
            os_type: "windows".to_string(),
            os_name: "Windows 11".to_string(),
            total_memory: 32768,
            gpus: vec![GpuInfo {
                name: "Test GPU".to_string(),
                total_memory: 12288,
                vendor: Vendor::NVIDIA,
                uuid: "gpu-1".to_string(),
                driver_version: "1.0".to_string(),
                nvidia_info: None,
                vulkan_info: None,
            }],
        }
    }

    #[test]
    fn parses_parameter_billions_from_name() {
        assert_eq!(parse_billions_from_text("qwen2.5-7b-instruct"), Some(7.0));
        assert_eq!(parse_billions_from_text("jan-v2-4.5b"), Some(4.5));
        assert_eq!(parse_billions_from_text("model-without-size"), None);
    }

    #[test]
    fn quant_tier_is_ranked_conservatively() {
        assert!(infer_quant_tier("model-q8_0.gguf") > infer_quant_tier("model-q4_k_m.gguf"));
        assert!(infer_quant_tier("model-q4_k_m.gguf") > infer_quant_tier("model-q2_k.gguf"));
    }

    #[test]
    fn hardware_fingerprint_changes_with_system_details() {
        let one = build_hardware_fingerprint(&mock_system_info());
        let mut other_info = mock_system_info();
        other_info.total_memory = 65536;
        let two = build_hardware_fingerprint(&other_info);
        assert_ne!(one, two);
    }

    #[test]
    fn cache_key_depends_on_hardware_fingerprint() {
        let request = HubModelScoreRequest {
            model_name: "test/model".to_string(),
            developer: Some("test".to_string()),
            default_quant_model_id: "test/model-q4".to_string(),
            model_path: "https://huggingface.co/test/model-q4.gguf".to_string(),
            ctx_size: Some(8192),
        };

        let one = build_cache_key(&request, "hardware-a");
        let two = build_cache_key(&request, "hardware-b");
        assert_ne!(one, two);
    }
}
