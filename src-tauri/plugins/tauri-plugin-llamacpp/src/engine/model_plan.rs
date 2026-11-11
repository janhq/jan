//! Which ggml kernels one particular model will actually use.
//!
//! The Full check runs every op upstream has a test for, which is 15 minutes a
//! device; the Quick check runs a fixed list, which cannot say anything about
//! the model in front of the user. This builds the third answer: read a GGUF's
//! tensor types and attention geometry, and run only the families that model's
//! graph contains, narrowed to its shapes through upstream's `-p` filter.
//!
//! Deliberately outside the `engine` feature and free of Tauri: it is a pure
//! function of a gguf's metadata, so `cargo test` covers it with no C++
//! toolchain and no ggml, exactly as [`super::diagnose`] is.
//!
//! The one thing this must never do is narrow a family to nothing and let the
//! run report a pass. It cannot know whether a regex matches until the leaf
//! runs, so it fails *open* -- a fact it could not read means no filter rather
//! than a guessed one -- and the root reports a unit that ran no cases as
//! [`super::diagnose::FamilyStatus::NoCases`].

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::diag::FamilyFilter;

/// What the root is asked to run for a model, as the worker receives it on
/// `--diagnose-plan`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelPlan {
    /// The model's file name, for the `start` event. Never the directory: that
    /// is the user's and means nothing to a result.
    pub model: String,
    pub families: Vec<FamilyFilter>,
}

/// ggml's own name for a type id, which is the spelling upstream's parameter
/// strings use (`ggml_type_name`, `ggml/src/ggml.c`).
///
/// `None` for an id this build has no name for: a filter must leave such a
/// tensor out rather than invent a name that matches nothing.
pub fn ggml_type_name(id: u32) -> Option<&'static str> {
    Some(match id {
        0 => "f32",
        1 => "f16",
        2 => "q4_0",
        3 => "q4_1",
        6 => "q5_0",
        7 => "q5_1",
        8 => "q8_0",
        9 => "q8_1",
        10 => "q2_K",
        11 => "q3_K",
        12 => "q4_K",
        13 => "q5_K",
        14 => "q6_K",
        15 => "q8_K",
        16 => "iq2_xxs",
        17 => "iq2_xs",
        18 => "iq3_xxs",
        19 => "iq1_s",
        20 => "iq4_nl",
        21 => "iq3_s",
        22 => "iq2_s",
        23 => "iq4_xs",
        29 => "iq1_m",
        30 => "bf16",
        34 => "tq1_0",
        35 => "tq2_0",
        39 => "mxfp4",
        40 => "nvfp4",
        41 => "q1_0",
        42 => "q2_0",
        43 => "f8_e4m3",
        // 24-28 are the integer and f64 types, which no weight uses, and the
        // gaps are types upstream removed.
        _ => return None,
    })
}

/// What a gguf says about the kernels a load will exercise.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelShape {
    pub architecture: Option<String>,
    /// ggml type names of the tensors, deduplicated, in the order
    /// [`ggml_type_name`] is defined. Read off the tensor block, so a mixture
    /// (Q4_K_M is q4_K plus q5_K, q6_K and f32) is reported as it really is.
    pub weight_types: Vec<String>,
    /// Attention head size, which is what sizes a flash-attention kernel.
    pub head_size_k: Option<u64>,
    pub head_size_v: Option<u64>,
    /// 0 for a dense model. Non-zero means the graph contains `MUL_MAT_ID`.
    pub expert_count: u64,
}

impl ModelShape {
    pub fn from_gguf(metadata: &HashMap<String, String>, tensor_types: &[u32]) -> Self {
        let architecture = metadata.get("general.architecture").cloned();
        let number = |suffix: &str| -> Option<u64> {
            let arch = architecture.as_deref()?;
            metadata
                .get(&format!("{arch}.{suffix}"))
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|n| *n > 0)
        };

        // llama.cpp's own fallback: with no explicit key/value length, both are
        // the embedding width divided by the head count.
        let fallback = match (number("embedding_length"), number("attention.head_count")) {
            (Some(embd), Some(heads)) if embd % heads == 0 => Some(embd / heads),
            _ => None,
        };

        Self {
            weight_types: tensor_types
                .iter()
                .filter_map(|id| ggml_type_name(*id))
                .map(str::to_string)
                .collect(),
            head_size_k: number("attention.key_length").or(fallback),
            head_size_v: number("attention.value_length").or(fallback),
            expert_count: number("expert_count").unwrap_or(0),
            architecture,
        }
    }
}

/// Families every transformer graph contains, and which are small enough to
/// run whole. Shared with the Quick preset, which is the same list plus the
/// big families under a common-shape filter.
pub const BASE_FAMILIES: &[&str] = &[
    "ADD", "SUB", "MUL", "DIV", "SCALE", "NORM", "RMS_NORM", "SOFT_MAX", "GET_ROWS", "SET_ROWS",
    "ROPE", "CPY", "CONT", "CONCAT", "SILU", "GELU", "SWIGLU", "GEGLU",
];

/// Architectures whose graph is recurrent rather than attention-only, and the
/// families that carries. Matched on a substring because upstream names a
/// family of them (`falcon_h1`, `granitemoehybrid`) rather than one.
const RECURRENT_FAMILIES: &[(&str, &[&str])] = &[
    ("mamba", &["SSM_CONV", "SSM_SCAN"]),
    ("jamba", &["SSM_CONV", "SSM_SCAN"]),
    ("falcon_h", &["SSM_CONV", "SSM_SCAN"]),
    ("hybrid", &["SSM_CONV", "SSM_SCAN"]),
    ("nemotron_h", &["SSM_CONV", "SSM_SCAN"]),
    ("plamo2", &["SSM_CONV", "SSM_SCAN"]),
    ("rwkv", &["RWKV_WKV6", "RWKV_WKV7"]),
];

/// Types every attention matmul uses whatever the weights are quantized to:
/// the KV cache defaults to f16 and the activations are f32. Leaving them out
/// would narrow `MUL_MAT` to the weight kernels alone and miss the attention
/// ones, which is where a broken device usually shows.
const ALWAYS_MATMUL_TYPES: &[&str] = &["f32", "f16"];

/// The weight types real downloads use, for the Quick preset's `MUL_MAT`.
/// Upstream also tests several research and accelerator-specific formats that
/// no model on the hub ships.
const COMMON_MATMUL_TYPES: &[&str] = &[
    "f32", "f16", "bf16", "q4_0", "q8_0", "q2_K", "q3_K", "q4_K", "q5_K", "q6_K", "iq4_xs", "mxfp4",
];

/// Head sizes the overwhelming majority of chat models use. Quick is a fixed
/// list, so this is a judgement about the population; the model check below
/// uses the one head size the file in front of us actually has.
const COMMON_HEAD_SIZES: &[u64] = &[64, 128];

/// Upstream's `-p` for a matmul over `types`: an alternation anchored on the
/// trailing comma of `type_a=<name>,` so `q4_0` cannot match `q4_0_whatever`
/// and a short name cannot prefix a longer one.
///
/// `None` when `types` is empty, which is the fail-open answer: a file whose
/// tensor types could not be read runs `MUL_MAT` unfiltered rather than
/// narrowed to the attention types, which would test none of the quantized
/// kernels the file actually uses.
fn matmul_filter(types: &[String]) -> Option<String> {
    if types.is_empty() {
        return None;
    }
    let mut names: Vec<&str> = types.iter().map(String::as_str).collect();
    for always in ALWAYS_MATMUL_TYPES {
        if !names.contains(always) {
            names.push(always);
        }
    }
    Some(format!("type_a=({}),", names.join("|")))
}

/// Upstream's `-p` for flash attention at one head geometry. `hsk` and `hsv`
/// lead the parameter string, so this is an exact match on the pair.
fn flash_attention_filter(head_size_k: u64, head_size_v: u64) -> String {
    format!("hsk={head_size_k},hsv={head_size_v},")
}

/// The Quick preset: the small families whole, plus the three expensive ones
/// narrowed to what real models use.
///
/// `MUL_MAT` and `FLASH_ATTN_EXT` are most of what a model spends its time in
/// and were absent from Quick entirely before this, because an unfiltered
/// `FLASH_ATTN_EXT` is 5,439 cases. Narrowing them is what makes including
/// them affordable.
pub fn quick_families() -> Vec<FamilyFilter> {
    let common: Vec<String> = COMMON_MATMUL_TYPES.iter().map(|s| s.to_string()).collect();
    let matmul = matmul_filter(&common);
    let heads = COMMON_HEAD_SIZES
        .iter()
        .map(|h| h.to_string())
        .collect::<Vec<_>>()
        .join("|");

    let mut out: Vec<FamilyFilter> = BASE_FAMILIES
        .iter()
        .map(|f| FamilyFilter::new(*f, None))
        .collect();
    out.push(FamilyFilter {
        family: "MUL_MAT".into(),
        params: matmul.clone(),
    });
    out.push(FamilyFilter {
        family: "MUL_MAT_ID".into(),
        params: matmul,
    });
    out.push(FamilyFilter::new(
        "FLASH_ATTN_EXT",
        Some(&format!("hsk=({heads}),hsv=({heads}),")),
    ));
    out
}

/// The families one model's graph contains, narrowed to its own shapes.
///
/// Fails open at every step: an unreadable head size runs flash attention
/// unfiltered rather than at a guessed geometry, and a file whose tensor types
/// are all unknown runs `MUL_MAT` unfiltered. Over-running costs minutes;
/// under-running costs the answer.
pub fn model_families(shape: &ModelShape) -> Vec<FamilyFilter> {
    let mut out: Vec<FamilyFilter> = BASE_FAMILIES
        .iter()
        .map(|f| FamilyFilter::new(*f, None))
        .collect();

    let matmul = matmul_filter(&shape.weight_types);
    out.push(FamilyFilter {
        family: "MUL_MAT".into(),
        params: matmul.clone(),
    });
    // A dense model has no expert routing, so its graph never reaches this op
    // and running 1,182 cases for it would only lengthen the wait.
    if shape.expert_count > 0 {
        out.push(FamilyFilter {
            family: "MUL_MAT_ID".into(),
            params: matmul,
        });
    }

    out.push(FamilyFilter::new(
        "FLASH_ATTN_EXT",
        match (shape.head_size_k, shape.head_size_v) {
            (Some(k), Some(v)) => Some(flash_attention_filter(k, v)),
            _ => None,
        }
        .as_deref(),
    ));

    let arch = shape.architecture.as_deref().unwrap_or("").to_lowercase();
    for (marker, families) in RECURRENT_FAMILIES {
        if arch.contains(marker) {
            for family in *families {
                if !out.iter().any(|f| f.family == *family) {
                    out.push(FamilyFilter::new(*family, None));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn filter_for<'a>(families: &'a [FamilyFilter], name: &str) -> Option<&'a FamilyFilter> {
        families.iter().find(|f| f.family == name)
    }

    #[test]
    fn a_q4_k_m_mixture_is_read_off_the_tensors_not_the_file_type() {
        // general.file_type says Q4_K_M; the tensors say q4_K, q5_K, q6_K, f32.
        let shape = ModelShape::from_gguf(
            &meta(&[
                ("general.architecture", "qwen3"),
                ("general.file_type", "15"),
            ]),
            &[0, 12, 13, 14],
        );
        assert_eq!(shape.weight_types, ["f32", "q4_K", "q5_K", "q6_K"]);
    }

    #[test]
    fn an_unknown_tensor_type_is_left_out_rather_than_guessed_at() {
        let shape = ModelShape::from_gguf(&meta(&[]), &[0, 12, 99]);
        assert_eq!(shape.weight_types, ["f32", "q4_K"]);
    }

    #[test]
    fn the_head_size_falls_back_to_the_embedding_width_over_the_head_count() {
        let shape = ModelShape::from_gguf(
            &meta(&[
                ("general.architecture", "llama"),
                ("llama.embedding_length", "4096"),
                ("llama.attention.head_count", "32"),
            ]),
            &[],
        );
        assert_eq!(shape.head_size_k, Some(128));
        assert_eq!(shape.head_size_v, Some(128));
    }

    #[test]
    fn an_explicit_key_length_wins_over_the_fallback() {
        let shape = ModelShape::from_gguf(
            &meta(&[
                ("general.architecture", "deepseek2"),
                ("deepseek2.embedding_length", "7168"),
                ("deepseek2.attention.head_count", "128"),
                ("deepseek2.attention.key_length", "576"),
                ("deepseek2.attention.value_length", "512"),
            ]),
            &[],
        );
        assert_eq!(shape.head_size_k, Some(576));
        assert_eq!(shape.head_size_v, Some(512));
    }

    #[test]
    fn a_head_size_that_does_not_divide_evenly_is_not_reported() {
        // Rather than a rounded one: a filter built on it would match nothing.
        let shape = ModelShape::from_gguf(
            &meta(&[
                ("general.architecture", "x"),
                ("x.embedding_length", "100"),
                ("x.attention.head_count", "3"),
            ]),
            &[],
        );
        assert_eq!(shape.head_size_k, None);
    }

    #[test]
    fn the_matmul_filter_always_carries_the_attention_types() {
        let params = filter_for(
            &model_families(&ModelShape {
                weight_types: vec!["q4_K".into()],
                ..Default::default()
            }),
            "MUL_MAT",
        )
        .and_then(|f| f.params.clone())
        .expect("MUL_MAT is filtered");
        assert!(params.contains("q4_K"), "{params}");
        assert!(params.contains("f16"), "{params}");
        assert!(params.contains("f32"), "{params}");
        assert!(
            params.ends_with("),"),
            "the trailing comma anchors it: {params}"
        );
    }

    #[test]
    fn a_type_is_not_repeated_when_the_model_already_has_it() {
        let params = matmul_filter(&["f32".into(), "f16".into()]).unwrap();
        assert_eq!(params, "type_a=(f32|f16),");
    }

    #[test]
    fn a_file_with_no_readable_types_runs_matrix_math_unfiltered() {
        // Fails open: narrowing to the attention types alone would run none of
        // the quantized kernels the file uses and still report a clean pass.
        let families = model_families(&ModelShape::default());
        let matmul = filter_for(&families, "MUL_MAT").expect("MUL_MAT is planned");
        assert_eq!(matmul.params, None);
    }

    #[test]
    fn flash_attention_is_pinned_to_the_models_own_head_size() {
        let families = model_families(&ModelShape {
            head_size_k: Some(128),
            head_size_v: Some(128),
            ..Default::default()
        });
        assert_eq!(
            filter_for(&families, "FLASH_ATTN_EXT").and_then(|f| f.params.as_deref()),
            Some("hsk=128,hsv=128,")
        );
    }

    #[test]
    fn an_unreadable_head_size_runs_flash_attention_whole() {
        let families = model_families(&ModelShape::default());
        assert_eq!(
            filter_for(&families, "FLASH_ATTN_EXT").map(|f| f.params.clone()),
            Some(None)
        );
    }

    #[test]
    fn expert_routing_is_planned_only_for_a_mixture_of_experts() {
        assert!(filter_for(&model_families(&ModelShape::default()), "MUL_MAT_ID").is_none());
        assert!(filter_for(
            &model_families(&ModelShape {
                expert_count: 128,
                ..Default::default()
            }),
            "MUL_MAT_ID"
        )
        .is_some());
    }

    #[test]
    fn a_recurrent_architecture_adds_its_own_families() {
        let families = model_families(&ModelShape {
            architecture: Some("falcon_h1".into()),
            ..Default::default()
        });
        assert!(filter_for(&families, "SSM_SCAN").is_some());
        assert!(filter_for(&families, "RWKV_WKV7").is_none());

        let rwkv = model_families(&ModelShape {
            architecture: Some("RWKV6".into()),
            ..Default::default()
        });
        assert!(filter_for(&rwkv, "RWKV_WKV6").is_some());
        assert!(filter_for(&rwkv, "SSM_SCAN").is_none());
    }

    #[test]
    fn the_quick_preset_covers_the_expensive_families_under_a_filter() {
        let families = quick_families();
        for name in ["MUL_MAT", "MUL_MAT_ID", "FLASH_ATTN_EXT"] {
            let f = filter_for(&families, name).unwrap_or_else(|| panic!("{name} is planned"));
            assert!(f.params.is_some(), "{name} must be narrowed");
        }
        // Every base family runs whole: they are small and on every token's path.
        for name in BASE_FAMILIES {
            assert_eq!(
                filter_for(&families, name).map(|f| f.params.clone()),
                Some(None),
                "{name}"
            );
        }
    }

    #[test]
    fn the_plan_round_trips_through_json() {
        let plan = ModelPlan {
            model: "qwen3-8b-q4_k_m.gguf".into(),
            families: model_families(&ModelShape {
                weight_types: vec!["q4_K".into()],
                head_size_k: Some(128),
                head_size_v: Some(128),
                expert_count: 0,
                architecture: Some("qwen3".into()),
            }),
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert_eq!(serde_json::from_str::<ModelPlan>(&json).unwrap(), plan);
        assert!(
            !json.contains(r#""params":null"#),
            "an absent filter is omitted: {json}"
        );
    }
}
