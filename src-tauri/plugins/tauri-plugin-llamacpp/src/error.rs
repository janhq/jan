use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    BinaryNotFound,
    ModelFileNotFound,
    LibraryPathInvalid,

    // --- Model Loading Errors ---
    ModelLoadFailed,
    DraftModelLoadFailed,
    MultimodalProjectorLoadFailed,
    ModelArchNotSupported,
    ModelLoadTimedOut,
    LlamaCppProcessError,
    // The model file (GGUF) is missing, truncated, or corrupt.
    ModelFileCorrupted,
    // The model uses an unsupported quantization scheme.
    UnsupportedQuantization,

    // --- Backend / Native Library Errors ---
    // The llama-server binary failed to load a required native library
    // (missing or code-signing-invalid dylib on macOS, missing shared object
    // on Linux, missing DLL on Windows).
    MissingNativeLibrary,
    // A GPU / accelerator driver or backend failed to initialize (CUDA,
    // Vulkan, Metal, ROCm).
    DeviceInitFailed,
    // The backend could not bind its listen socket or lacked permission.
    PortBindFailed,

    // --- Memory Errors ---
    OutOfMemory,

    // --- Configuration Errors ---
    InvalidArgument,

    // --- Internal Application Errors ---
    DeviceListParseFailed,
    IoError,
    InternalError,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("LlamacppError {{ code: {code:?}, message: \"{message}\", details: {details:?} }}")]
// NOTE: `details` is deliberately part of the Display output (not just the
// Serialize shape) so the raw backend stderr survives the IPC boundary. Tauri
// commands that return `Result<_, String>` (e.g. `start_router`) collapse the
// error through its `Display` impl, and without it here the distinguishing
// stderr is dropped before it ever reaches the frontend.
pub struct LlamacppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl LlamacppError {
    pub fn new(code: ErrorCode, message: String, details: Option<String>) -> Self {
        Self {
            code,
            message,
            details,
        }
    }

    /// Parses stderr from llama.cpp and creates a specific LlamacppError.
    ///
    /// Precedence matters: OOM/arch are checked before the looser
    /// device-init and quantization signals (a CUDA error often contains both
    /// "cuda" and "unsupported"/"failed"), so the most specific causes win.
    /// The generic [`ErrorCode::LlamaCppProcessError`] fallback is last, so a
    /// newly-encountered cause still surfaces the raw stderr in `details`.
    pub fn from_stderr(stderr: &str) -> Self {
        let lower = stderr.to_lowercase();

        // --- Native library / dynamic-loader failures ---
        // macOS dyld: "dyld: Library not loaded: ...", "code signature ... not
        // valid"; Linux: "error while loading shared libraries: ...";
        // Windows: missing-DLL. This is the issue #8476 case.
        let is_missing_library = lower.contains("library not loaded")
            || lower.contains("code signature")
            || lower.contains("image not found")
            || lower.contains("symbol not found")
            || lower.contains("error while loading shared libraries")
            || lower.contains("cannot open shared object file")
            || lower.contains("the specified module could not be found")
            || lower.contains("not found in dyld cache")
            || lower.contains("not loaded")
            || (lower.contains(".dll") && lower.contains("not found"))
            || (lower.contains("lib") && lower.contains("not found"));

        if is_missing_library {
            return Self::new(
                ErrorCode::MissingNativeLibrary,
                "A required native library failed to load. Reinstall the app or update the llama.cpp backend, then restart Jan. On macOS, re-signing the backend (or reinstalling) usually fixes dyld code-signature errors.".into(),
                Some(stderr.into()),
            );
        }

        // --- Out of memory ---
        // Dense form strips underscores/spaces so every spelling is caught:
        // "out of memory", "VK_ERROR_OUT_OF_DEVICE_MEMORY",
        // "MTLCommandBufferErrorOutOfMemory", "cuda_error_out_of_memory".
        let dense = lower
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>();
        let is_out_of_memory = lower.contains("out of memory")
            || lower.contains("failed to allocate")
            || lower.contains("insufficient memory")
            || dense.contains("outofmemory")
            || dense.contains("outofdevicememory")
            || dense.contains("outofhostmemory");

        if is_out_of_memory {
            return Self::new(
                ErrorCode::OutOfMemory,
                "Out of memory. The model requires more RAM or VRAM than available. Try a smaller model, a lower quantization, or reduce the GPU offload (n_gpu_layers).".into(),
                Some(stderr.into()),
            );
        }

        // --- Unsupported model architecture ---
        if lower.contains("error loading model architecture") {
            return Self::new(
                ErrorCode::ModelArchNotSupported,
                "The model's architecture is not supported by this version of the backend. Update the llama.cpp backend or use a compatible model.".into(),
                Some(stderr.into()),
            );
        }

        // --- Device / driver initialization failures (CUDA, Vulkan, Metal, ROCm) ---
        // Checked after OOM/arch because GPU initialization errors frequently
        // reuse those words ("CUDA error: out of memory", "... not supported").
        let names_backend = lower.contains("cuda")
            || lower.contains("vulkan")
            || lower.contains("metal")
            || lower.contains("rocm")
            || lower.contains("hip")
            || lower.contains("cublas")
            || lower.contains("cudnn")
            || lower.contains("device");
        let is_device_init = names_backend
            && (lower.contains("no suitable device")
                || lower.contains("no available")
                || lower.contains("no physical device")
                || lower.contains("no supported")
                || lower.contains("failed to initialize")
                || lower.contains("failed to init")
                || lower.contains("initialization failed")
                || lower.contains("unable to initialize")
                || lower.contains("unable to create")
                || lower.contains("device error")
                || lower.contains("driver error")
                || lower.contains("vk_error")
                || lower.contains("vulkan_error")
                || lower.contains("hip_error")
                || lower.contains("rock_error")
                || lower.contains("cudaerror")
                || lower.contains("cuda error")
                || lower.contains("non zero exit code")
                || lower.contains("cannot allocate")
                || lower.contains("not available")
                || lower.contains("returned nil"));

        if is_device_init {
            return Self::new(
                ErrorCode::DeviceInitFailed,
                "Your GPU driver or backend failed to initialize. Update your graphics driver, then restart Jan. If the problem persists, lower the GPU offload setting (n_gpu_layers) or switch to CPU-only inference.".into(),
                Some(stderr.into()),
            );
        }

        // --- Port bind / permission failures ---
        let is_port_bind = lower.contains("address already in use")
            || lower.contains("address in use")
            || lower.contains("failed to bind")
            || lower.contains("cannot assign requested address")
            || lower.contains("permission denied")
            || lower.contains("access denied")
            || lower.contains("operation not permitted")
            || lower.contains("eacces");

        if is_port_bind {
            return Self::new(
                ErrorCode::PortBindFailed,
                "The backend could not bind its network port or lacked the required permission. Close other programs using that port, or restart Jan.".into(),
                Some(stderr.into()),
            );
        }

        // --- Unsupported quantization ---
        let is_bad_quant = lower.contains("unsupported quantization")
            || lower.contains("unknown quantization")
            || lower.contains("quantization not supported")
            || lower.contains("unimplemented quantization")
            || lower.contains("failed to quantize")
            || lower.contains("k-quants");

        if is_bad_quant {
            return Self::new(
                ErrorCode::UnsupportedQuantization,
                "The model uses a quantization this backend does not support. Try a different quantization (e.g. Q4_K_M) or a different model, then re-download it.".into(),
                Some(stderr.into()),
            );
        }

        // --- Model file corruption / truncation ---
        let is_file_corrupt = lower.contains("unexpected end")
            || lower.contains("unterminated")
            || lower.contains("magic not found")
            || lower.contains("corrupt")
            || lower.contains("truncated")
            || lower.contains("invalid gguf")
            || lower.contains("not a valid gguf")
            || lower.contains("invalid model")
            || lower.contains("attempting to deserialize")
            || lower.contains("no tensors in model")
            || lower.contains("model file is empty")
            || lower.contains("failed to open model")
            || lower.contains("failed to load model");

        if is_file_corrupt {
            return Self::new(
                ErrorCode::ModelFileCorrupted,
                "The model file appears to be missing, truncated, or corrupt. Delete it and re-download the model, then try again.".into(),
                Some(stderr.into()),
            );
        }

        // --- Generic fallback: keep the raw stderr so any unclassified cause
        // still gives the user something actionable to paste into a report. ---
        Self::new(
            ErrorCode::LlamaCppProcessError,
            "The model process encountered an unexpected error. See the details below for the backend log; if you need help, include those details in your bug report.".into(),
            Some(stderr.into()),
        )
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
    use super::{ErrorCode, LlamacppError};

    struct Case {
        name: &'static str,
        stderr: &'static str,
        expected: ErrorCode,
    }

    fn assert_classifies(cases: &[Case]) {
        for case in cases {
            let err = LlamacppError::from_stderr(case.stderr);
            assert_eq!(
                err.code,
                case.expected,
                "case {:?} misclassified stderr: {:?}",
                case.name,
                case.stderr
            );
            // The raw stderr must always survive in `details`.
            assert!(
                err.details.as_deref().is_some(),
                "case {:?} dropped details",
                case.name
            );
        }
    }

    #[test]
    fn classifies_dyld_code_signature_from_issue_8476() {
        // Exact dyld text reported in janhq/jan#8476 on an Intel macOS Sequoia
        // box: llama-server exits before readiness because the OpenSSL dylib it
        // references fails Apple's code-signature check. Previously this
        // surfaced as the meaningless generic LlamaCppProcessError.
        let stderr = "\
dyld[61912]: Library not loaded: /usr/local/opt/openssl@3/lib/libssl.3.dylib
Referenced from: <F3708359-10A4-3CBC-9986-4C233ABD470D> /Users/giorg/Library/Application Support/Jan/data/llamacpp/backends/b8892/macos-x64/build/bin/llama-server
Reason: tried: '/usr/local/opt/openssl@3/lib/libssl.3.dylib' (code signature in <B8FB4D89-43C0-36DC-88AF-C97B69B75031> '/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs), '/System/Volumes/Preboot/Cryptexes/OS/usr/local/opt/openssl@3/lib/libssl.3.dylib' (no such file), '/usr/local/opt/openssl@3/lib/libssl.3.dylib' (code signature in <B8FB4D89-43C0-36DC-88AF-C97B69B75031> '/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs), '/usr/lib/libssl.3.dylib' (no such file, not in dyld cache), '/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' (code signature in <B8FB4D89-43C0-36DC-88AF-C97B69B75031> '/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs), '/System/Volumes/Preboot/Cryptexes/OS/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' (no such file), '/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' (code signature in <B8FB4D89-43C0-36DC-88AF-C97B69B75031> '/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs), '/usr/lib/libssl.3.dylib' (no such file, not in dyld cache)";
        let cases = [Case {
            name: "dyld code-signature (issue #8476)",
            stderr,
            expected: ErrorCode::MissingNativeLibrary,
        }];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_native_library_loader_failures() {
        let cases = [
            Case {
                name: "macOS dyld Library not loaded",
                stderr: "dyld: Library not loaded: /usr/local/lib/libggml.dylib\nReferenced from: /path/llama-server\nReason: image not found",
                expected: ErrorCode::MissingNativeLibrary,
            },
            Case {
                name: "Linux shared library load error",
                stderr: "/path/llama-server: error while loading shared libraries: libcudart.so.12: cannot open shared object file: No such file or directory",
                expected: ErrorCode::MissingNativeLibrary,
            },
            Case {
                name: "Windows missing DLL",
                stderr: "The code execution cannot proceed because cudart64_12.dll was not found. Reinstalling the program may fix this problem.",
                expected: ErrorCode::MissingNativeLibrary,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_out_of_memory() {
        let cases = [
            Case {
                name: "generic OOM",
                stderr: "llama_model_load: error: failed to allocate memory",
                expected: ErrorCode::OutOfMemory,
            },
            Case {
                name: "CUDA OOM",
                stderr: "CUDA error: out of memory. cuMemAlloc failed",
                expected: ErrorCode::OutOfMemory,
            },
            Case {
                name: "Vulkan out of device memory",
                stderr: "Vulkan error: vkAllocateMemory returned VK_ERROR_OUT_OF_DEVICE_MEMORY",
                expected: ErrorCode::OutOfMemory,
            },
            Case {
                name: "Metal out of memory",
                stderr: "Metal command buffer error: MTLCommandBufferErrorOutOfMemory",
                expected: ErrorCode::OutOfMemory,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_model_architecture_not_supported() {
        let cases = [
            Case {
                name: "arch not supported",
                stderr: "error loading model architecture: 'llama' from ... supported architectures are: gpt2",
                expected: ErrorCode::ModelArchNotSupported,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_device_driver_init_failures() {
        let cases = [
            Case {
                name: "CUDA driver init failure",
                stderr: "ggml_cuda_init: failed to initialize CUDA: no suitable device found for CUDA",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "Vulkan device not available",
                stderr: "ggml_vulkan: Vulkan error: vkCreateInstance: no available physical devices",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "Metal device error",
                stderr: "ggml_metal: unable to create Metal device: MTLCreateSystemDefaultDevice returned nil",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "ROCm/HIP initialization",
                stderr: "ggml_rocm: hipErrorNoDevice: no HIP-compatible device found; failed to initialize ROCm",
                expected: ErrorCode::DeviceInitFailed,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_quantization_not_supported() {
        let cases = [
            Case {
                name: "unsupported quantization",
                stderr: "unsupported quantization type: 5",
                expected: ErrorCode::UnsupportedQuantization,
            },
            Case {
                name: "unknown quantization",
                stderr: "ggml: unknown quantization type 17 in model",
                expected: ErrorCode::UnsupportedQuantization,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_model_file_corruption() {
        let cases = [
            Case {
                name: "truncated GGUF",
                stderr: "error: unexpected end of file while reading GGUF model",
                expected: ErrorCode::ModelFileCorrupted,
            },
            Case {
                name: "not a valid GGUF",
                stderr: "error: not a valid GGUF file: magic header mismatch",
                expected: ErrorCode::ModelFileCorrupted,
            },
            Case {
                name: "corrupt model file",
                stderr: "llama_model_load_from_file: failed to load model: file appears truncated or corrupt",
                expected: ErrorCode::ModelFileCorrupted,
            },
            Case {
                name: "failed to open model",
                stderr: "error: failed to open model file /models/foo.gguf: No such file or directory",
                expected: ErrorCode::ModelFileCorrupted,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_port_bind_and_permission_failures() {
        let cases = [
            Case {
                name: "port already in use",
                stderr: "llama-server: error: couldn't listen on socket: address already in use",
                expected: ErrorCode::PortBindFailed,
            },
            Case {
                name: "permission denied binding",
                stderr: "error: failed to bind to 0.0.0.0:5000: permission denied",
                expected: ErrorCode::PortBindFailed,
            },
            Case {
                name: "EACCES",
                stderr: "bind: Cannot assign requested address (os error 49)",
                expected: ErrorCode::PortBindFailed,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn falls_back_to_generic_and_keeps_details() {
        let cases = [
            Case {
                name: "unknown non-const-like backend stderr",
                stderr: "fatal: some completely unknown backend failure happened",
                expected: ErrorCode::LlamaCppProcessError,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn display_includes_details_so_raw_stderr_survives_ipc() {
        let err = LlamacppError::from_stderr("dyld: Library not loaded: /x/libssl.dylib");
        let display = err.to_string();
        assert!(
            display.contains("Library not loaded: /x/libssl.dylib"),
            "Display must carry the raw details, got: {display}"
        );
        assert!(
            display.contains("code: MissingNativeLibrary"),
            "Display should reflect the classified code, got: {display}"
        );
    }
}
