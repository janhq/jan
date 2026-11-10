//! What a failed model load carries so a bug report can be acted on without a
//! back-and-forth: the request, the machine, the engine and the engine's own
//! log. Everything stays local; it rides on [`crate::error::LlamacppError`] to
//! the UI, which formats it for the user to paste.

use serde::{Deserialize, Serialize};

use crate::engine::preset;

/// Largest captured log kept on an error. The newest lines win: the load's
/// verdict is printed last, and the worker's own backend announcements are
/// reported separately.
pub const MAX_LOG_BYTES: usize = 64 * 1024;

/// The settings a load was asked for, as the preset spells them. `None` is a
/// setting the preset leaves to llama.cpp's default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoadRequest {
    pub ctx_size: Option<String>,
    pub n_gpu_layers: Option<String>,
    pub load_mode: Option<String>,
    pub flash_attn: Option<String>,
    pub cache_type_k: Option<String>,
    pub cache_type_v: Option<String>,
    pub device: Option<String>,
    pub fit: Option<String>,
}

impl LoadRequest {
    pub fn from_preset(ini: &str, model_id: &str) -> Self {
        let get = |key: &str| preset::value(ini, model_id, key);
        Self {
            ctx_size: get("ctx-size"),
            n_gpu_layers: get("n-gpu-layers"),
            load_mode: get("load-mode"),
            flash_attn: get("flash-attn"),
            cache_type_k: get("cache-type-k"),
            cache_type_v: get("cache-type-v"),
            device: get("device"),
            fit: get("fit"),
        }
    }
}

/// A GPU as the machine reports it, with memory in MiB.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GpuReport {
    pub name: String,
    pub driver_version: String,
    pub total_mib: u64,
    /// `None` when the vendor gives no usage figure.
    pub free_mib: Option<u64>,
}

/// The pinned engine, whose tag is mutable upstream while the commit is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineBuild {
    pub version: String,
    pub tag: String,
    pub commit: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoadDiagnostics {
    /// File name only: the directory is the user's and means nothing to us.
    pub model_file: Option<String>,
    pub architecture: Option<String>,
    pub quantization: Option<String>,
    pub request: LoadRequest,
    pub gpus: Vec<GpuReport>,
    /// Backend modules the worker loaded, e.g. `CUDA (libggml-cuda.so)`.
    pub backends: Vec<String>,
    pub engine: EngineBuild,
    /// What the worker printed during the load, capped at [`MAX_LOG_BYTES`].
    pub log: String,
    /// True when older lines were dropped to fit the cap or the buffer.
    pub log_truncated: bool,
}

/// The last name in a path of either separator style. A model path comes from
/// the preset, which can hold a Windows path while this runs on Unix in tests.
pub fn file_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

/// Joins `lines`, dropping the oldest until the text fits `max_bytes`. The
/// flag is true when anything was dropped, here or by the caller
/// (`already_truncated`).
pub fn cap_log(lines: &[String], max_bytes: usize, already_truncated: bool) -> (String, bool) {
    let mut kept = 0usize;
    let mut size = 0usize;
    for line in lines.iter().rev() {
        let next = size + line.len() + 1;
        if next > max_bytes {
            break;
        }
        size = next;
        kept += 1;
    }
    let start = lines.len() - kept;
    (
        lines[start..].join("\n"),
        already_truncated || start > 0,
    )
}

/// llama.cpp's name for a `general.file_type` value (`enum llama_ftype`).
pub fn quantization_name(file_type: u32) -> Option<&'static str> {
    Some(match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        7 => "Q8_0",
        8 => "Q5_0",
        9 => "Q5_1",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        19 => "IQ2_XXS",
        20 => "IQ2_XS",
        21 => "Q2_K_S",
        22 => "IQ3_XS",
        23 => "IQ3_XXS",
        24 => "IQ1_S",
        25 => "IQ4_NL",
        26 => "IQ3_S",
        27 => "IQ3_M",
        28 => "IQ2_S",
        29 => "IQ2_M",
        30 => "IQ4_XS",
        31 => "IQ1_M",
        32 => "BF16",
        36 => "TQ1_0",
        37 => "TQ2_0",
        38 => "MXFP4_MOE",
        _ => return None,
    })
}

/// Architecture and quantization out of GGUF metadata.
pub fn model_traits(
    metadata: &std::collections::HashMap<String, String>,
) -> (Option<String>, Option<String>) {
    let architecture = metadata.get("general.architecture").cloned();
    let quantization = metadata
        .get("general.file_type")
        .and_then(|v| v.parse::<u32>().ok())
        .map(|t| quantization_name(t).map_or_else(|| format!("ftype {t}"), str::to_string));
    (architecture, quantization)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_reads_the_model_line_over_the_shared_block() {
        let ini = "[*]\nctx-size = 8192\nflash-attn = auto\n[m]\nctx-size = 4096\nn-gpu-layers = 20\ndevice = Vulkan0\n";
        let r = LoadRequest::from_preset(ini, "m");
        assert_eq!(r.ctx_size.as_deref(), Some("4096"));
        assert_eq!(r.n_gpu_layers.as_deref(), Some("20"));
        assert_eq!(r.flash_attn.as_deref(), Some("auto"));
        assert_eq!(r.device.as_deref(), Some("Vulkan0"));
        assert_eq!(r.load_mode, None);
    }

    #[test]
    fn a_model_path_is_reduced_to_its_file_name() {
        assert_eq!(file_name("/home/bob/models/qwen.gguf"), "qwen.gguf");
        assert_eq!(file_name(r"C:\Users\bob\models\qwen.gguf"), "qwen.gguf");
        assert_eq!(file_name("qwen.gguf"), "qwen.gguf");
    }

    #[test]
    fn the_log_cap_keeps_the_newest_lines_and_says_so() {
        let lines: Vec<String> = (0..10).map(|i| format!("line {i}")).collect();
        let (all, cut) = cap_log(&lines, MAX_LOG_BYTES, false);
        assert!(!cut);
        assert_eq!(all.lines().count(), 10);

        // "line N" is 6 bytes plus a newline: room for three.
        let (tail, cut) = cap_log(&lines, 21, false);
        assert!(cut);
        assert_eq!(tail, "line 7\nline 8\nline 9");

        let (_, cut) = cap_log(&lines, MAX_LOG_BYTES, true);
        assert!(cut, "a truncation upstream of the cap still counts");
        assert_eq!(cap_log(&[], 10, false), (String::new(), false));
    }

    #[test]
    fn quantization_and_architecture_come_from_the_gguf_metadata() {
        let meta = [
            ("general.architecture", "qwen3"),
            ("general.file_type", "15"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        assert_eq!(
            model_traits(&meta),
            (Some("qwen3".into()), Some("Q4_K_M".into()))
        );

        let odd = [("general.file_type".to_string(), "999".to_string())]
            .into_iter()
            .collect();
        assert_eq!(model_traits(&odd), (None, Some("ftype 999".into())));
    }
}
