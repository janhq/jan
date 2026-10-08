use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // --- Model Loading Errors ---
    ModelLoadFailed,
    ModelArchNotSupported,
    ModelLoadTimedOut,
    MissingSharedLibrary,
    GpuDriverTooOld,

    // --- Memory Errors ---
    OutOfMemory,

    // --- Configuration Errors ---
    InvalidArgument,

    // --- Internal Application Errors ---
    IoError,
    InternalError,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("LlamacppError {{ code: {code:?}, message: \"{message}\" }}")]
pub struct LlamacppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// Library names the loader could not resolve, so the UI can turn them into
    /// install advice instead of showing raw engine output.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_libraries: Option<Vec<String>>,
}

impl LlamacppError {
    pub fn new(code: ErrorCode, message: String, details: Option<String>) -> Self {
        Self {
            code,
            message,
            details,
            missing_libraries: None,
        }
    }

    /// Classifies engine output from a failed model load. An unrecognized
    /// reason is a failed load rather than a crashed process, and `details`
    /// keeps llama.cpp's own words so the UI can show them next to the
    /// localized advice instead of an HTTP status line.
    pub fn from_load_failure(output: &str) -> Self {
        Self::classify(output).unwrap_or_else(|| {
            Self::new(
                ErrorCode::ModelLoadFailed,
                "The model could not be loaded.".into(),
                Some(output.into()),
            )
        })
    }

    /// None when no marker matched, so each caller supplies its own fallback.
    fn classify(output: &str) -> Option<Self> {
        let lower = output.to_lowercase();
        // TODO: add others
        let is_out_of_memory = lower.contains("out of memory")
            || lower.contains("failed to allocate")
            || lower.contains("insufficient memory")
            || lower.contains("erroroutofdevicememory") // vulkan specific
            || lower.contains("kiogpucommandbuffercallbackerroroutofmemory") // Metal-specific error code
            || lower.contains("cuda_error_out_of_memory"); // CUDA-specific

        if is_out_of_memory {
            return Some(Self::new(
                ErrorCode::OutOfMemory,
                "Out of memory. The model requires more RAM or VRAM than available.".into(),
                Some(output.into()),
            ));
        }

        // A dynamic-loader failure is why a mismatched GPU backend dies on
        // launch; without this it lands on the generic process error.
        if is_missing_library(&lower) {
            let libs = extract_missing_libraries(output);
            let mut err = Self::new(
                ErrorCode::MissingSharedLibrary,
                "A library this backend depends on is missing.".into(),
                Some(output.into()),
            );
            err.missing_libraries = (!libs.is_empty()).then_some(libs);
            return Some(err);
        }

        if is_driver_too_old(&lower) {
            return Some(Self::new(
                ErrorCode::GpuDriverTooOld,
                "The installed GPU driver is too old for this backend.".into(),
                Some(output.into()),
            ));
        }

        if lower.contains("error loading model architecture") {
            return Some(Self::new(
                ErrorCode::ModelArchNotSupported,
                "The model's architecture is not supported by this version of the backend.".into(),
                Some(output.into()),
            ));
        }

        None
    }
}

// Deliberately specific: a bare "was not found" also matches a missing model
// file, which is a different failure with different advice.
const MISSING_LIBRARY_MARKERS: [&str; 5] = [
    "cannot open shared object file",
    "library not loaded",
    ".dll was not found",
    "the specified module could not be found",
    "image not found",
];

const DRIVER_TOO_OLD_MARKERS: [&str; 5] = [
    "driver version is insufficient",
    "cudaerrorinsufficientdriver",
    "error_incompatible_driver",
    "unsupported display driver",
    "forward compatibility was attempted on non supported",
];

fn is_missing_library(lower: &str) -> bool {
    MISSING_LIBRARY_MARKERS
        .iter()
        .any(|m| lower.contains(m))
}

fn is_driver_too_old(lower: &str) -> bool {
    DRIVER_TOO_OLD_MARKERS
        .iter()
        .any(|m| lower.contains(m))
}

fn looks_like_library(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(char::is_whitespace)
        && (name.contains(".so") || name.ends_with(".dylib") || name.ends_with(".dll"))
}

/// Pulls unresolved library names out of loader diagnostics. Case is preserved,
/// so this reads the original text rather than a lowercased copy.
fn extract_missing_libraries(output: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();

    for line in output.lines() {
        let lower = line.to_lowercase();

        // `<...>: libfoo.so.1: cannot open shared object file: ...`
        if let Some(idx) = lower.find("cannot open shared object file") {
            let head = line[..idx].trim_end_matches([' ', ':']);
            let candidate = head.rsplit([':', ' ']).next().unwrap_or("").trim();
            push_library(&mut found, candidate);
        }

        // macOS: `Library not loaded: @rpath/libfoo.dylib`
        if let Some(idx) = lower.find("library not loaded:") {
            let tail = line[idx + "library not loaded:".len()..].trim();
            let candidate = tail.split_whitespace().next().unwrap_or("");
            push_library(&mut found, basename(candidate));
        }

        // Windows: `because cudart64_12.dll was not found.`
        if let Some(idx) = lower.find(".dll was not found").map(|i| i + ".dll".len()) {
            let head = line[..idx].trim_end();
            let candidate = head.split_whitespace().last().unwrap_or("");
            push_library(&mut found, basename(candidate));
        }
    }

    found
}

fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn push_library(found: &mut Vec<String>, candidate: &str) {
    let candidate = candidate.trim_matches(['\'', '"', '(', ')', ',', '.'].as_ref());
    if looks_like_library(candidate) && !found.iter().any(|f| f == candidate) {
        found.push(candidate.to_string());
    }
}

// Error type for server commands
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    Llamacpp(#[from] LlamacppError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Invalid argument: {0}")]
    InvalidArgument(String),
}

// impl serialization for tauri
impl serde::Serialize for ServerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let error_to_serialize: LlamacppError = match self {
            ServerError::Llamacpp(err) => err.clone(),
            ServerError::Io(e) => LlamacppError::new(
                ErrorCode::IoError,
                "An input/output error occurred.".into(),
                Some(e.to_string()),
            ),
            ServerError::Tauri(e) => LlamacppError::new(
                ErrorCode::InternalError,
                "An internal application error occurred.".into(),
                Some(e.to_string()),
            ),
            ServerError::InvalidArgument(msg) => LlamacppError::new(
                ErrorCode::InvalidArgument,
                "Invalid configuration argument provided.".into(),
                Some(msg.clone()),
            ),
        };
        error_to_serialize.serialize(serializer)
    }
}

pub type ServerResult<T> = Result<T, ServerError>;

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(output: &str) -> LlamacppError {
        LlamacppError::from_load_failure(output)
    }

    // The UI matches on these exact strings to pick a localized message, so the
    // wire format is part of the contract, not an implementation detail.
    #[test]
    fn error_codes_serialize_to_the_strings_the_ui_matches_on() {
        let cases = [
            (ErrorCode::ModelLoadFailed, "MODEL_LOAD_FAILED"),
            (ErrorCode::ModelArchNotSupported, "MODEL_ARCH_NOT_SUPPORTED"),
            (ErrorCode::ModelLoadTimedOut, "MODEL_LOAD_TIMED_OUT"),
            (ErrorCode::MissingSharedLibrary, "MISSING_SHARED_LIBRARY"),
            (ErrorCode::GpuDriverTooOld, "GPU_DRIVER_TOO_OLD"),
            (ErrorCode::OutOfMemory, "OUT_OF_MEMORY"),
            (ErrorCode::InvalidArgument, "INVALID_ARGUMENT"),
            (ErrorCode::IoError, "IO_ERROR"),
            (ErrorCode::InternalError, "INTERNAL_ERROR"),
        ];

        for (code, expected) in cases {
            assert_eq!(
                serde_json::to_string(&code).unwrap(),
                format!("\"{expected}\"")
            );
        }
    }

    #[test]
    fn a_serialized_error_carries_the_fields_the_ui_reads() {
        let err = LlamacppError::from_load_failure(
            "libcudart.so.12: cannot open shared object file: No such file or directory",
        );
        let json: serde_json::Value = serde_json::to_value(&err).unwrap();

        assert_eq!(json["code"], "MISSING_SHARED_LIBRARY");
        assert!(json["details"].is_string());
        assert_eq!(json["missing_libraries"][0], "libcudart.so.12");
    }

    // Absent rather than null, so an optional field never reaches the UI as a
    // present-but-empty value.
    #[test]
    fn absent_optional_fields_are_omitted() {
        let err = LlamacppError::new(ErrorCode::InternalError, "boom".into(), None);
        let json: serde_json::Value = serde_json::to_value(&err).unwrap();

        assert!(json.get("details").is_none(), "{json}");
        assert!(json.get("missing_libraries").is_none(), "{json}");
    }

    #[test]
    fn classifies_the_linux_loader_missing_library_message() {
        let err = classify(
            "/home/u/.local/share/Jan/data/llamacpp/backends/b9145/linux-cuda-12-common_cpus-x64/build/bin/llama-server: \
             error while loading shared libraries: libcudart.so.12: cannot open shared object file: No such file or directory",
        );
        assert!(matches!(err.code, ErrorCode::MissingSharedLibrary), "{err:?}");
        assert_eq!(err.missing_libraries.as_deref(), Some(&["libcudart.so.12".to_string()][..]));
    }

    #[test]
    fn classifies_a_failed_ggml_backend_dlopen() {
        let err = classify(
            "ggml_backend_load_best: failed to load backend from /opt/jan/libggml-cuda.so: \
             libcublas.so.12: cannot open shared object file: No such file or directory",
        );
        assert!(matches!(err.code, ErrorCode::MissingSharedLibrary), "{err:?}");
        assert_eq!(err.missing_libraries.as_deref(), Some(&["libcublas.so.12".to_string()][..]));
    }

    #[test]
    fn classifies_the_macos_dyld_message() {
        let err = classify(
            "dyld[4213]: Library not loaded: @rpath/libggml-metal.dylib\n  \
             Referenced from: /Applications/Jan.app/Contents/Resources/bin/llama-server\n  \
             Reason: tried: '/usr/lib/libggml-metal.dylib' (no such file)",
        );
        assert!(matches!(err.code, ErrorCode::MissingSharedLibrary), "{err:?}");
        assert_eq!(err.missing_libraries.as_deref(), Some(&["libggml-metal.dylib".to_string()][..]));
    }

    #[test]
    fn classifies_the_windows_missing_dll_message() {
        let err = classify(
            "The code execution cannot proceed because cudart64_12.dll was not found. \
             Reinstalling the program may fix this problem.",
        );
        assert!(matches!(err.code, ErrorCode::MissingSharedLibrary), "{err:?}");
        assert_eq!(err.missing_libraries.as_deref(), Some(&["cudart64_12.dll".to_string()][..]));
    }

    #[test]
    fn reports_every_distinct_missing_library_once() {
        let err = classify(
            "libcublas.so.12: cannot open shared object file: No such file or directory\n\
             libcudart.so.12: cannot open shared object file: No such file or directory\n\
             libcublas.so.12: cannot open shared object file: No such file or directory",
        );
        assert_eq!(
            err.missing_libraries.as_deref(),
            Some(&["libcublas.so.12".to_string(), "libcudart.so.12".to_string()][..])
        );
    }

    // Classified even with no parseable name, so the user still learns the cause.
    #[test]
    fn classifies_a_windows_module_error_without_a_name() {
        let err = classify("LoadLibrary failed: The specified module could not be found.");
        assert!(matches!(err.code, ErrorCode::MissingSharedLibrary), "{err:?}");
        assert!(err.missing_libraries.is_none(), "{err:?}");
    }

    #[test]
    fn classifies_an_insufficient_cuda_driver() {
        for stderr in [
            "cuda error: CUDA driver version is insufficient for CUDA runtime version",
            "cudaErrorInsufficientDriver",
            "ggml_vulkan: vkCreateInstance failed: ERROR_INCOMPATIBLE_DRIVER",
            "forward compatibility was attempted on non supported HW",
            "system has unsupported display driver / cuda driver combination",
        ] {
            let err = classify(stderr);
            assert!(matches!(err.code, ErrorCode::GpuDriverTooOld), "{stderr} -> {err:?}");
        }
    }

    #[test]
    fn preserves_the_existing_classifications() {
        assert!(matches!(
            classify("ggml_backend_cuda_buffer_type_alloc_buffer: CUDA_ERROR_OUT_OF_MEMORY").code,
            ErrorCode::OutOfMemory
        ));
        assert!(matches!(
            classify("error loading model architecture: unknown arch 'foo'").code,
            ErrorCode::ModelArchNotSupported
        ));
        assert!(matches!(
            classify("something else entirely went wrong").code,
            ErrorCode::ModelLoadFailed
        ));
    }

    #[test]
    fn always_keeps_the_raw_engine_output_in_details() {
        let raw = "libcudart.so.12: cannot open shared object file: No such file or directory";
        assert_eq!(classify(raw).details.as_deref(), Some(raw));
    }

    // A missing model file is a different failure with different advice, and it
    // shares the "was not found" wording.
    #[test]
    fn does_not_treat_a_missing_model_file_as_a_missing_library() {
        let err = classify("gguf_init_from_file: model.gguf was not found");
        assert!(!matches!(err.code, ErrorCode::MissingSharedLibrary), "{err:?}");
    }

    // A plain path ending in .so must not be mistaken for the missing library.
    #[test]
    fn ignores_library_paths_that_are_not_the_missing_one() {
        let err = classify(
            "ggml_backend_load_best: failed to load backend from /opt/jan/libggml-cuda.so: \
             libcublas.so.12: cannot open shared object file: No such file or directory",
        );
        let libs = err.missing_libraries.unwrap();
        assert!(!libs.iter().any(|l| l.contains("ggml-cuda")), "{libs:?}");
    }
}
