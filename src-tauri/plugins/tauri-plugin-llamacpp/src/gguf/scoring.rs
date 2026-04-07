use super::types::{
    GgufMetadata, HubModelScoreRequest, HubModelScoreResult, ModelScoreBreakdown, ModelScoreStatus,
};
use super::utils::read_gguf_metadata_internal;
use crate::gguf::commands::get_model_size;
use llmfit_core::fit::{FitLevel, InferenceRuntime, RunMode};
use llmfit_core::hardware::{GpuBackend, GpuInfo as LlmfitGpuInfo, SystemSpecs as LlmfitSystemSpecs};
use llmfit_core::models::{quant_bytes_per_param, Capability, LlmModel, ModelFormat};
use llmfit_core::ModelFit;
use std::collections::HashMap;
use tauri::Runtime;
use tauri_plugin_hardware::{get_system_info, SystemInfo, Vendor};

const DEFAULT_CTX_SIZE: u32 = 8192;
const RESERVE_BYTES: u64 = 2_288_490_189;

#[derive(Debug, Clone)]
struct DerivedModelSpec {
    parameter_count: String,
    parameters_raw: u64,
    quantization: String,
    context_length: u32,
    use_case: String,
    capabilities: Vec<Capability>,
    is_moe: bool,
    num_experts: Option<u32>,
    active_experts: Option<u32>,
    active_parameters: Option<u64>,
    release_date: Option<String>,
    num_attention_heads: Option<u32>,
    num_key_value_heads: Option<u32>,
    license: Option<String>,
}

pub async fn score_hub_model_internal<R: Runtime>(
    _app_handle: tauri::AppHandle<R>,
    request: HubModelScoreRequest,
) -> Result<HubModelScoreResult, String> {
    let system_info = get_system_info();

    let score_result = match compute_score_result(&request, &system_info).await {
        Ok((overall, estimated_tps, breakdown)) => HubModelScoreResult {
            status: ModelScoreStatus::Ready,
            overall: Some(overall),
            estimated_tps: Some(estimated_tps),
            breakdown: Some(breakdown),
            scored_quant_model_id: request.default_quant_model_id.clone(),
            used_builtin_fallback: false,
            reason: None,
        },
        Err(reason) => HubModelScoreResult {
            status: ModelScoreStatus::Unavailable,
            overall: None,
            breakdown: None,
            estimated_tps: None,
            scored_quant_model_id: request.default_quant_model_id.clone(),
            used_builtin_fallback: false,
            reason: Some(reason),
        },
    };
    Ok(score_result)
}

async fn compute_score_result(
    request: &HubModelScoreRequest,
    system_info: &SystemInfo,
) -> Result<(f32, f32, ModelScoreBreakdown), String> {
    let gguf = read_gguf_metadata_internal(request.model_path.clone()).await?;
    let model_size = get_model_size(request.model_path.clone()).await?;
    let derived = derive_model_spec(request, &gguf, model_size)?;
    let llmfit_model = build_llmfit_model(request, &derived);
    let llmfit_system = build_llmfit_system_specs(system_info);

    let analysis = ModelFit::analyze_with_forced_runtime(
        &llmfit_model,
        &llmfit_system,
        Some(request.ctx_size.unwrap_or(DEFAULT_CTX_SIZE)),
        Some(InferenceRuntime::LlamaCpp),
    );

    Ok((
        clamp_score(analysis.score as f32),
        analysis.estimated_tps as f32,
        ModelScoreBreakdown {
            quality: clamp_score(analysis.score_components.quality as f32),
            speed: clamp_score(analysis.score_components.speed as f32),
            fit: clamp_score(analysis.score_components.fit as f32),
            context: clamp_score(analysis.score_components.context as f32),
            best_quant: analysis.best_quant,
            fit_level: match analysis.fit_level {
                FitLevel::Perfect => "Perfect".to_string(),
                FitLevel::Good => "Good".to_string(),
                FitLevel::Marginal => "Marginal".to_string(),
                FitLevel::TooTight => "Too Tight".to_string(),
            },
            run_mode: match analysis.run_mode {
                RunMode::Gpu => "GPU".to_string(),
                RunMode::CpuOffload => "CPU Offload".to_string(),
                RunMode::CpuOnly => "CPU Only".to_string(),
                RunMode::MoeOffload => "MoE Offload".to_string(),
                RunMode::TensorParallel => "Tensor Parallel".to_string(),
            },
            memory_required_gb: analysis.memory_required_gb,
            utilization_pct: analysis.utilization_pct,
            use_case: format!("{:?}", analysis.use_case),
        },
    ))
}

fn derive_model_spec(
    request: &HubModelScoreRequest,
    gguf: &GgufMetadata,
    model_size: u64,
) -> Result<DerivedModelSpec, String> {
    let quantization = normalize_quantization(&request.default_quant_model_id)
        .ok_or_else(|| "Unsupported or unrecognized GGUF quantization".to_string())?;
    let context_length = infer_context_length(gguf, request.ctx_size)
        .ok_or_else(|| "Unable to determine GGUF context length".to_string())?;

    let parameters_raw = infer_parameter_count_raw(request, gguf, model_size, &quantization)
        .ok_or_else(|| "Unable to determine model parameter count for llmfit".to_string())?;

    let inferred_use_case = request
        .use_case
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| infer_use_case(request, gguf));
    let capabilities = request
        .capabilities
        .clone()
        .map(|capabilities| {
            capabilities
                .into_iter()
                .filter_map(|capability| normalize_capability(capability.as_str()))
                .collect::<Vec<_>>()
        })
        .filter(|capabilities| !capabilities.is_empty())
        .unwrap_or_else(|| infer_capabilities(request, gguf, &inferred_use_case));

    let num_experts = infer_metadata_u32(gguf, &["*.expert_count", "*.n_expert"]);
    let active_experts =
        infer_metadata_u32(gguf, &["*.expert_used_count", "*.expert_used_count", "*.n_expert_used"]);
    let is_moe = num_experts.unwrap_or(0) > 0;
    let active_parameters = if is_moe {
        match (num_experts, active_experts) {
            (Some(total), Some(active)) if total > 0 && active > 0 => {
                Some(((parameters_raw as u128 * active as u128) / total as u128) as u64)
            }
            _ => None,
        }
    } else {
        None
    };

    Ok(DerivedModelSpec {
        parameter_count: human_parameter_count(parameters_raw),
        parameters_raw,
        quantization,
        context_length,
        use_case: inferred_use_case,
        capabilities,
        is_moe,
        num_experts,
        active_experts,
        active_parameters,
        release_date: request.release_date.clone(),
        num_attention_heads: infer_metadata_u32(gguf, &["*.attention.head_count"]),
        num_key_value_heads: infer_metadata_u32(gguf, &["*.attention.head_count_kv"]),
        license: gguf.metadata.get("general.license").cloned(),
    })
}

fn build_llmfit_model(request: &HubModelScoreRequest, spec: &DerivedModelSpec) -> LlmModel {
    let mut model = LlmModel {
        name: request.model_name.clone(),
        provider: request.developer.clone().unwrap_or_else(|| infer_provider(request)),
        parameter_count: spec.parameter_count.clone(),
        parameters_raw: Some(spec.parameters_raw),
        min_ram_gb: 0.0,
        recommended_ram_gb: 0.0,
        min_vram_gb: None,
        quantization: spec.quantization.clone(),
        context_length: spec.context_length,
        use_case: spec.use_case.clone(),
        is_moe: spec.is_moe,
        num_experts: spec.num_experts,
        active_experts: spec.active_experts,
        active_parameters: spec.active_parameters,
        release_date: spec.release_date.clone(),
        gguf_sources: vec![],
        capabilities: spec.capabilities.clone(),
        format: ModelFormat::Gguf,
        num_attention_heads: spec.num_attention_heads,
        num_key_value_heads: spec.num_key_value_heads,
        license: spec.license.clone(),
    };

    let baseline_memory = model.estimate_memory_gb(model.quantization.as_str(), model.context_length);
    model.min_ram_gb = round_gb(baseline_memory);
    model.recommended_ram_gb = round_gb((baseline_memory * 1.2).max(baseline_memory + 1.0));
    model.min_vram_gb = Some(round_gb(baseline_memory.max(0.5)));

    model
}

fn build_llmfit_system_specs(system_info: &SystemInfo) -> LlmfitSystemSpecs {
    let total_ram_gb = mib_to_gb(system_info.total_memory);
    let available_ram_gb = mib_to_gb(system_info.total_memory.saturating_sub(bytes_to_mib(RESERVE_BYTES)));

    let mut grouped_gpu_counts: HashMap<(String, &'static str, bool), (f64, u32)> = HashMap::new();
    for gpu in &system_info.gpus {
        let backend = infer_gpu_backend(system_info, gpu);
        let unified = is_unified_memory_gpu(system_info, gpu, backend);
        let key = (gpu.name.clone(), backend_label(backend), unified);
        let entry = grouped_gpu_counts.entry(key).or_insert((mib_to_gb(gpu.total_memory), 0));
        entry.0 = entry.0.max(mib_to_gb(gpu.total_memory));
        entry.1 += 1;
    }

    let mut gpus: Vec<LlmfitGpuInfo> = grouped_gpu_counts
        .into_iter()
        .map(|((name, backend_name, unified_memory), (vram_gb, count))| LlmfitGpuInfo {
            name,
            vram_gb: Some(vram_gb),
            backend: match backend_name {
                "cuda" => GpuBackend::Cuda,
                "metal" => GpuBackend::Metal,
                "rocm" => GpuBackend::Rocm,
                "sycl" => GpuBackend::Sycl,
                _ => GpuBackend::Vulkan,
            },
            count,
            unified_memory,
        })
        .collect();

    if gpus.is_empty() && is_apple_silicon(system_info) {
        gpus.push(LlmfitGpuInfo {
            name: system_info.cpu.name.clone(),
            vram_gb: Some(total_ram_gb),
            backend: GpuBackend::Metal,
            count: 1,
            unified_memory: true,
        });
    }

    gpus.sort_by(|left, right| {
        right
            .vram_gb
            .unwrap_or_default()
            .partial_cmp(&left.vram_gb.unwrap_or_default())
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let primary = gpus.first().cloned();
    let cpu_backend = if system_info.cpu.arch.contains("arm") || is_apple_silicon(system_info) {
        GpuBackend::CpuArm
    } else {
        GpuBackend::CpuX86
    };

    LlmfitSystemSpecs {
        total_ram_gb,
        available_ram_gb: available_ram_gb.max(0.5),
        total_cpu_cores: system_info.cpu.core_count,
        cpu_name: system_info.cpu.name.clone(),
        has_gpu: primary.is_some(),
        gpu_vram_gb: primary.as_ref().and_then(|gpu| gpu.vram_gb),
        total_gpu_vram_gb: primary
            .as_ref()
            .and_then(|gpu| gpu.vram_gb.map(|vram| vram * gpu.count as f64)),
        gpu_name: primary.as_ref().map(|gpu| gpu.name.clone()),
        gpu_count: primary.as_ref().map(|gpu| gpu.count).unwrap_or(0),
        unified_memory: primary.as_ref().map(|gpu| gpu.unified_memory).unwrap_or(false),
        backend: primary.as_ref().map(|gpu| gpu.backend).unwrap_or(cpu_backend),
        gpus,
        cluster_mode: false,
        cluster_node_count: 0,
    }
}

fn infer_parameter_count_raw(
    request: &HubModelScoreRequest,
    gguf: &GgufMetadata,
    model_size: u64,
    quantization: &str,
) -> Option<u64> {
    let text_candidates = [
        request.default_quant_model_id.as_str(),
        request.model_name.as_str(),
        gguf.metadata
            .get("general.name")
            .map(String::as_str)
            .unwrap_or_default(),
    ];

    for candidate in text_candidates {
        if let Some(value) = parse_parameter_count_from_text(candidate) {
            return Some(value);
        }
    }

    let bytes_per_param = quant_bytes_per_param(quantization);
    if bytes_per_param <= 0.0 || model_size == 0 {
        return None;
    }

    Some(((model_size as f64 / bytes_per_param).round()) as u64)
}

fn parse_parameter_count_from_text(input: &str) -> Option<u64> {
    let lower = input.to_ascii_lowercase();
    let bytes = lower.as_bytes();

    for index in 0..bytes.len() {
        if !bytes[index].is_ascii_digit() {
            continue;
        }

        let mut end = index;
        while end < bytes.len() && (bytes[end].is_ascii_digit() || bytes[end] == b'.') {
            end += 1;
        }

        if end >= bytes.len() {
            continue;
        }

        let multiplier = match bytes[end] {
            b'b' => 1_000_000_000.0,
            b'm' => 1_000_000.0,
            _ => continue,
        };

        if let Ok(value) = lower[index..end].parse::<f64>() {
            return Some((value * multiplier).round() as u64);
        }
    }

    None
}

fn infer_context_length(gguf: &GgufMetadata, requested_ctx: Option<u32>) -> Option<u32> {
    let architecture = gguf.metadata.get("general.architecture")?;
    let context = gguf
        .metadata
        .get(&format!("{architecture}.context_length"))
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)?;

    Some(requested_ctx.map(|ctx| ctx.max(context)).unwrap_or(context))
}

fn infer_use_case(request: &HubModelScoreRequest, gguf: &GgufMetadata) -> String {
    let combined = format!(
        "{} {} {}",
        request.model_name,
        request.default_quant_model_id,
        gguf.metadata
            .get("general.name")
            .map(String::as_str)
            .unwrap_or_default()
    )
    .to_ascii_lowercase();

    if combined.contains("embed") || combined.contains("embedding") || combined.contains("bge") {
        "Embedding".to_string()
    } else if combined.contains("coder") || combined.contains("code") {
        "Code generation and completion".to_string()
    } else if request.num_mmproj.unwrap_or(0) > 0
        || combined.contains("vision")
        || combined.contains("-vl")
        || combined.contains("llava")
        || combined.contains("pixtral")
    {
        "Multimodal instruction following".to_string()
    } else if combined.contains("reason") || combined.contains("r1") {
        "Reasoning".to_string()
    } else if combined.contains("instruct") || combined.contains("chat") {
        "Instruction following".to_string()
    } else {
        "General purpose text generation".to_string()
    }
}

fn infer_capabilities(
    request: &HubModelScoreRequest,
    gguf: &GgufMetadata,
    use_case: &str,
) -> Vec<Capability> {
    let mut capabilities = Vec::new();
    let combined = format!(
        "{} {} {}",
        request.model_name,
        request.default_quant_model_id,
        gguf.metadata
            .get("general.name")
            .map(String::as_str)
            .unwrap_or_default()
    )
    .to_ascii_lowercase();

    if use_case.to_ascii_lowercase().contains("multimodal")
        || request.num_mmproj.unwrap_or(0) > 0
        || combined.contains("vision")
        || combined.contains("-vl")
        || combined.contains("llava")
        || combined.contains("pixtral")
    {
        capabilities.push(Capability::Vision);
    }

    let chat_template = gguf
        .metadata
        .get("tokenizer.chat_template")
        .map(String::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if request.tools.unwrap_or(false)
        || combined.contains("instruct")
        || combined.contains("qwen")
        || combined.contains("tool")
        || chat_template.contains("tools")
        || chat_template.contains("tool_call")
        || chat_template.contains("function")
    {
        capabilities.push(Capability::ToolUse);
    }

    capabilities
}

fn normalize_capability(capability: &str) -> Option<Capability> {
    match capability.trim().to_ascii_lowercase().as_str() {
        "vision" => Some(Capability::Vision),
        "tool_use" | "tool-use" | "tool use" | "tools" => Some(Capability::ToolUse),
        _ => None,
    }
}

fn normalize_quantization(input: &str) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    if lower.contains("bf16") {
        Some("BF16".to_string())
    } else if lower.contains("f16") {
        Some("F16".to_string())
    } else if lower.contains("q8") {
        Some("Q8_0".to_string())
    } else if lower.contains("q6") {
        Some("Q6_K".to_string())
    } else if lower.contains("q5") {
        Some("Q5_K_M".to_string())
    } else if lower.contains("q4") || lower.contains("iq4") {
        Some("Q4_K_M".to_string())
    } else if lower.contains("q3") || lower.contains("iq3") {
        Some("Q3_K_M".to_string())
    } else if lower.contains("q2") || lower.contains("iq2") {
        Some("Q2_K".to_string())
    } else {
        None
    }
}

fn infer_metadata_u32(gguf: &GgufMetadata, patterns: &[&str]) -> Option<u32> {
    let architecture = gguf.metadata.get("general.architecture")?;
    for pattern in patterns {
        let key = pattern.replace('*', architecture);
        if let Some(value) = gguf.metadata.get(&key).and_then(|value| value.parse::<u32>().ok()) {
            return Some(value);
        }
    }
    None
}

fn infer_provider(request: &HubModelScoreRequest) -> String {
    request
        .model_name
        .split('/')
        .next()
        .unwrap_or("unknown")
        .to_string()
}

fn infer_gpu_backend(system_info: &SystemInfo, gpu: &tauri_plugin_hardware::GpuInfo) -> GpuBackend {
    match gpu.vendor {
        Vendor::NVIDIA => GpuBackend::Cuda,
        Vendor::AMD => {
            if system_info.os_type.to_ascii_lowercase().contains("linux") {
                GpuBackend::Rocm
            } else {
                GpuBackend::Vulkan
            }
        }
        Vendor::Intel => GpuBackend::Sycl,
        Vendor::Unknown(_) => {
            if is_apple_silicon(system_info) {
                GpuBackend::Metal
            } else {
                GpuBackend::Vulkan
            }
        }
    }
}

fn is_unified_memory_gpu(
    system_info: &SystemInfo,
    gpu: &tauri_plugin_hardware::GpuInfo,
    backend: GpuBackend,
) -> bool {
    matches!(backend, GpuBackend::Metal)
        || (matches!(gpu.vendor, Vendor::AMD) && system_info.cpu.name.to_ascii_lowercase().contains("ryzen ai"))
}

fn is_apple_silicon(system_info: &SystemInfo) -> bool {
    let os = system_info.os_type.to_ascii_lowercase();
    let cpu = system_info.cpu.name.to_ascii_lowercase();
    os.contains("mac") && cpu.contains("apple")
}

fn backend_label(backend: GpuBackend) -> &'static str {
    match backend {
        GpuBackend::Cuda => "cuda",
        GpuBackend::Metal => "metal",
        GpuBackend::Rocm => "rocm",
        GpuBackend::Sycl => "sycl",
        _ => "vulkan",
    }
}

fn human_parameter_count(parameters_raw: u64) -> String {
    if parameters_raw >= 1_000_000_000 {
        format!("{:.1}B", parameters_raw as f64 / 1_000_000_000.0)
    } else {
        format!("{:.0}M", parameters_raw as f64 / 1_000_000.0)
    }
}

fn round_gb(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn mib_to_gb(value_mib: u64) -> f64 {
    value_mib as f64 / 1024.0
}

fn bytes_to_mib(value_bytes: u64) -> u64 {
    value_bytes / (1024 * 1024)
}

fn clamp_score(value: f32) -> f32 {
    (value.clamp(0.0, 100.0) * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_request() -> HubModelScoreRequest {
        HubModelScoreRequest {
            model_name: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF".to_string(),
            developer: Some("Qwen".to_string()),
            default_quant_model_id: "Qwen/Qwen2.5-Coder-7B-Instruct-Q4_K_M".to_string(),
            model_path: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/model-q4_k_m.gguf".to_string(),
            ctx_size: Some(8192),
            use_case: Some("Code generation and completion".to_string()),
            capabilities: Some(vec!["tool_use".to_string()]),
            release_date: Some("2024-09-19T00:00:00.000Z".to_string()),
            tools: Some(true),
            num_mmproj: Some(0),
            pinned: Some(false),
        }
    }

    fn mock_gguf() -> GgufMetadata {
        GgufMetadata {
            version: 3,
            tensor_count: 1,
            metadata: HashMap::from([
                ("general.architecture".to_string(), "llama".to_string()),
                ("llama.context_length".to_string(), "32768".to_string()),
                ("general.name".to_string(), "Qwen2.5-Coder-7B-Instruct".to_string()),
                ("tokenizer.chat_template".to_string(), "{{ tools }}".to_string()),
            ]),
        }
    }

    #[test]
    fn parses_parameter_count_from_name() {
        assert_eq!(
            parse_parameter_count_from_text("qwen2.5-7b-instruct"),
            Some(7_000_000_000)
        );
        assert_eq!(
            parse_parameter_count_from_text("jan-v2-4.5b"),
            Some(4_500_000_000)
        );
        assert_eq!(parse_parameter_count_from_text("model-without-size"), None);
    }

    #[test]
    fn normalizes_gguf_quantization_for_llmfit() {
        assert_eq!(
            normalize_quantization("model-q8_0.gguf").as_deref(),
            Some("Q8_0")
        );
        assert_eq!(
            normalize_quantization("model-q4_k_m.gguf").as_deref(),
            Some("Q4_K_M")
        );
        assert_eq!(
            normalize_quantization("model-iq2_xs.gguf").as_deref(),
            Some("Q2_K")
        );
    }

    #[test]
    fn derives_model_spec_from_request_and_metadata() {
        let spec = derive_model_spec(&mock_request(), &mock_gguf(), 4_200_000_000)
            .expect("expected derived model spec");

        assert_eq!(spec.quantization, "Q4_K_M");
        assert_eq!(spec.context_length, 32768);
        assert_eq!(spec.parameters_raw, 7_000_000_000);
        assert_eq!(spec.use_case, "Code generation and completion");
        assert!(spec.capabilities.contains(&Capability::ToolUse));
    }
}
