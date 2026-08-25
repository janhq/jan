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
        // macOS dyld: "Library not loaded: ...", "code signature ... not valid";
        // Linux ld.so: "error while loading shared libraries: ...";
        // Windows: missing DLL. This is the issue #8476 case.
        //
        // These must key off loader-specific wording, NOT a bare "lib"
        // substring: llama.cpp always logs its backend paths on startup
        // ("load_backend: loaded Metal backend from .../libggml-metal.dylib")
        // and every macOS home path contains "Library", so pairing "lib" with
        // "not found" would swallow any later, unrelated "... not found".
        let is_missing_library = lower.contains("library not loaded")
            || lower.contains("code signature")
            || lower.contains("image not found")
            || lower.contains("symbol not found")
            || lower.contains("not in dyld cache")
            || lower.contains("error while loading shared libraries")
            || lower.contains("cannot open shared object file")
            || lower.contains("the specified module could not be found")
            || lower.contains("dll not found")
            || (lower.contains(".dll") && lower.contains("was not found"))
            || lower.contains("dyld:")
            || lower.contains("dyld[")
            || lower.contains("ld.so:");

        if is_missing_library {
            return Self::new(
                ErrorCode::MissingNativeLibrary,
                "A required native library failed to load. Reinstall the app or update the llama.cpp backend, then restart Jan. On macOS, re-signing the backend (or reinstalling) usually fixes dyld code-signature errors.".into(),
                Some(stderr.into()),
            );
        }

        // --- Out of memory ---
        // Dense form strips separators so every vendor spelling is caught:
        // "VK_ERROR_OUT_OF_DEVICE_MEMORY", "MTLCommandBufferErrorOutOfMemory",
        // "cuda_error_out_of_memory". The plain-text arms cover ggml's own
        // allocator wording, which says "unable to allocate" as often as
        // "failed to allocate" (e.g. "error loading model: unable to allocate
        // CUDA0 buffer" for VRAM exhaustion).
        let dense = lower
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>();
        let is_out_of_memory = lower.contains("out of memory")
            || lower.contains("failed to allocate")
            || lower.contains("unable to allocate")
            || lower.contains("cannot allocate")
            || lower.contains("insufficient memory")
            || lower.contains("not enough space in the buffer")
            || lower.contains("std::bad_alloc")
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
        // Upstream throws "unknown model architecture: '<arch>'" /
        // "unsupported model architecture: '<arch>'" (src/llama-model.cpp),
        // which llama.cpp then prints as "error loading model: <that text>".
        // The two fragments never concatenate into "error loading model
        // architecture", so match the thrown wording itself.
        let is_bad_arch = lower.contains("unknown model architecture")
            || lower.contains("unsupported model architecture")
            || lower.contains("error loading model architecture")
            || lower.contains("unknown architecture")
            || lower.contains("not implemented for architecture");

        if is_bad_arch {
            return Self::new(
                ErrorCode::ModelArchNotSupported,
                "The model's architecture is not supported by this version of the backend. Update the llama.cpp backend (Settings -> Model Providers -> llama.cpp) or use a compatible model.".into(),
                Some(stderr.into()),
            );
        }

        // --- Device / driver initialization failures (CUDA, Vulkan, Metal, ROCm) ---
        // Checked after OOM/arch because GPU failures reuse those words
        // ("CUDA error: out of memory", "... not supported"), and the more
        // specific cause gives better advice.
        //
        // Strings verified against upstream ggml backends: ggml-cuda.cu,
        // ggml-vulkan.cpp, ggml-metal-context.m.
        let names_backend = lower.contains("cuda")
            || lower.contains("vulkan")
            || lower.contains("metal")
            || lower.contains("rocm")
            || lower.contains("hip ")
            || lower.contains("cublas")
            || lower.contains("cudnn")
            || lower.contains("ggml_backend")
            || lower.contains("gpu");
        let is_device_init = lower.contains("no cuda-capable device")
            || lower.contains("driver version is insufficient")
            || lower.contains("is not supported on this system")
            || (names_backend
                && (lower.contains("no suitable device")
                    || lower.contains("no devices found")
                    || lower.contains("no available device")
                    || lower.contains("no available physical device")
                    || lower.contains("no physical device")
                    || lower.contains("no compatible device")
                    || lower.contains("invalid device index")
                    || lower.contains("does not support")
                    || lower.contains("required.")
                    || lower.contains("failed to initialize")
                    || lower.contains("failed to init")
                    || lower.contains("initialization failed")
                    || lower.contains("unable to initialize")
                    || lower.contains("failed to create")
                    || lower.contains("unable to create")
                    || lower.contains("device error")
                    || lower.contains("driver error")
                    || lower.contains("vk_error")
                    || lower.contains("hip_error")
                    || lower.contains("cudaerror")
                    || lower.contains("cuda error")
                    || lower.contains("device not available")));

        if is_device_init {
            return Self::new(
                ErrorCode::DeviceInitFailed,
                "Your GPU driver or backend failed to initialize. Update your graphics driver, then restart Jan. If the problem persists, lower the GPU offload setting (n_gpu_layers) or switch to CPU-only inference.".into(),
                Some(stderr.into()),
            );
        }

        // --- Port bind / permission failures ---
        // Upstream llama-server logs "couldn't bind HTTP server socket,
        // hostname: %s, port: %d" (tools/server/server-http.cpp).
        //
        // A bare "permission denied" only counts when it is about the socket:
        // the same phrase appears for an unreadable model file, where telling
        // the user to free a port would be wrong.
        let mentions_socket = lower.contains("bind")
            || lower.contains("socket")
            || lower.contains("port")
            || lower.contains("listen");
        let is_port_bind = lower.contains("address already in use")
            || lower.contains("address in use")
            || lower.contains("couldn't bind")
            || lower.contains("could not bind")
            || lower.contains("failed to bind")
            || lower.contains("cannot assign requested address")
            || (mentions_socket
                && (lower.contains("permission denied")
                    || lower.contains("access denied")
                    || lower.contains("operation not permitted")
                    || lower.contains("eacces")));

        if is_port_bind {
            return Self::new(
                ErrorCode::PortBindFailed,
                "The backend could not bind its network port or lacked the required permission. Close other programs using that port, or restart Jan.".into(),
                Some(stderr.into()),
            );
        }

        // --- Unsupported quantization / tensor type ---
        // Upstream validates tensor types in gguf.cpp ("has invalid ggml
        // type") and reports unknown ftypes from the model loader. A bare
        // "k-quants" is deliberately NOT a signal: llama.cpp prints
        // informational k-quant lines during a normal, successful load.
        let is_bad_quant = lower.contains("unsupported quantization")
            || lower.contains("unknown quantization")
            || lower.contains("quantization not supported")
            || lower.contains("unimplemented quantization")
            || lower.contains("invalid ggml type")
            || lower.contains("unknown ggml type")
            || lower.contains("unknown ftype")
            || lower.contains("failed to quantize");

        if is_bad_quant {
            return Self::new(
                ErrorCode::UnsupportedQuantization,
                "The model uses a quantization this backend does not support. Try a different quantization (e.g. Q4_K_M) or update the llama.cpp backend.".into(),
                Some(stderr.into()),
            );
        }

        // --- Model file unreadable (missing path / permissions) ---
        // Distinct from corruption: the bytes may be fine and we simply cannot
        // open them, so "delete and re-download" would be wrong advice.
        let mentions_model_file = lower.contains(".gguf")
            || lower.contains("model file")
            || lower.contains("failed to open model")
            || lower.contains("load_model");
        let is_file_unreadable = mentions_model_file
            && (lower.contains("permission denied")
                || lower.contains("no such file")
                || lower.contains("not a directory")
                || lower.contains("is a directory")
                || lower.contains("operation not permitted")
                || lower.contains("access is denied"));

        if is_file_unreadable {
            return Self::new(
                ErrorCode::ModelFileNotFound,
                "The model file could not be opened. Check that the file still exists and that Jan has permission to read it, then re-select or re-download the model.".into(),
                Some(stderr.into()),
            );
        }

        // --- Model file corruption / truncation ---
        // Only true integrity signals belong here. The trailing
        // "failed to load model" summary line is deliberately excluded: llama.cpp
        // appends it after almost any load failure, so treating it as a
        // corruption signal turns this bucket into a second fallback and tells
        // users to re-download a perfectly good file.
        let is_file_corrupt = lower.contains("unexpected end")
            || lower.contains("invalid magic")
            || lower.contains("failed to read magic")
            || lower.contains("magic not found")
            || lower.contains("corrupt")
            || lower.contains("truncated")
            || lower.contains("invalid gguf")
            || lower.contains("not a valid gguf")
            || lower.contains("bad gguf version")
            || lower.contains("gguf file is version")
            || lower.contains("ggufv1 is no longer supported")
            || lower.contains("failed to read header")
            || lower.contains("failed to read key-value pairs")
            || lower.contains("failed to read tensor info")
            || lower.contains("failed to read tensor data")
            || lower.contains("failed to seek to beginning of data section")
            || lower.contains("no tensors in model")
            || lower.contains("model file is empty")
            || lower.contains("failed to open gguf file")
            || lower.contains("failed to open model");

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

    struct Case<'a> {
        name: &'a str,
        stderr: &'a str,
        expected: ErrorCode,
    }

    /// Asserts the whole table, collecting every mismatch so one regression
    /// does not hide the rest.
    fn assert_classifies(cases: &[Case]) {
        let mut failures = Vec::new();
        for case in cases {
            let err = LlamacppError::from_stderr(case.stderr);
            if err.code != case.expected {
                failures.push(format!(
                    "  {:?}: expected {:?}, got {:?}\n    stderr: {:?}",
                    case.name, case.expected, err.code, case.stderr
                ));
            }
            // The raw stderr must survive verbatim in `details`; comparing
            // against the input catches a bucket that drops or truncates it.
            assert_eq!(
                err.details.as_deref(),
                Some(case.stderr),
                "case {:?} must carry the raw stderr in details",
                case.name
            );
        }
        assert!(
            failures.is_empty(),
            "{} of {} cases misclassified:\n{}",
            failures.len(),
            cases.len(),
            failures.join("\n")
        );
    }

    /// Real llama.cpp startup banner. Present on every macOS launch, it names
    /// backend dylib paths, and the Jan data dir contains "Library" - which is
    /// why library detection must not key off a bare "lib" substring.
    const MACOS_BANNER: &str = "load_backend: loaded Metal backend from /Users/g/Library/Application Support/Jan/data/llamacpp/backends/b8892/macos-x64/build/bin/libggml-metal.dylib\nload_backend: loaded CPU backend from /Users/g/Library/Application Support/Jan/data/llamacpp/backends/b8892/macos-x64/build/bin/libggml-cpu.dylib\n";

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
            // Isolates the code-signature rule: no "Library not loaded"
            // header, so only the Team-ID mismatch can classify this.
            Case {
                name: "code signature only (no loader header)",
                stderr: "code signature in <B8FB4D89-43C0-36DC-88AF-C97B69B75031> '/usr/local/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib' not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs",
                expected: ErrorCode::MissingNativeLibrary,
            },
            // Isolates the dyld-cache rule with upstream's real wording.
            Case {
                name: "dyld cache miss only",
                stderr: "Reason: tried: '/usr/lib/libssl.3.dylib' (no such file, not in dyld cache)",
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
            // The common real GPU-OOM report: ggml says "unable to allocate",
            // and the trailing summary line must not steal this for the
            // corruption bucket.
            Case {
                name: "CUDA VRAM exhaustion (real blob)",
                stderr: "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 7168.00 MiB on device 0 failed\nllama_model_load: error loading model: unable to allocate CUDA0 buffer\nllama_load_model_from_file: failed to load model",
                expected: ErrorCode::OutOfMemory,
            },
            Case {
                name: "host OOM via std::bad_alloc",
                stderr: "terminate called after throwing an instance of 'std::bad_alloc'\n  what():  std::bad_alloc",
                expected: ErrorCode::OutOfMemory,
            },
            Case {
                name: "ggml allocator buffer exhaustion",
                stderr: "ggml_tallocr_alloc: not enough space in the buffer to allocate 1024 bytes",
                expected: ErrorCode::OutOfMemory,
            },
        ];
        assert_classifies(&cases);
    }

    #[test]
    fn classifies_model_architecture_not_supported() {
        let cases = [
            // Upstream throws "unknown model architecture: '<arch>'" and
            // llama.cpp prints it as "error loading model: <text>". The literal
            // "error loading model architecture" never appears, and the
            // trailing summary line must not divert this to ModelFileCorrupted.
            Case {
                name: "unknown arch (real blob)",
                stderr: "llama_model_load: error loading model: unknown model architecture: 'gemma3n'\nllama_load_model_from_file: failed to load model '/models/gemma3n.gguf'\nmain: error: unable to load model",
                expected: ErrorCode::ModelArchNotSupported,
            },
            Case {
                name: "unsupported arch (real thrown text)",
                stderr: "llama_model_load: error loading model: unsupported model architecture: 'qwen3next'",
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
            // Real upstream strings: cudaErrorNoDevice / cudaErrorInsufficientDriver
            // (ggml-cuda.cu) and the Metal-unsupported path (ggml-metal).
            Case {
                name: "no CUDA-capable device (real)",
                stderr: "ggml_cuda_init: no CUDA-capable device is detected",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "insufficient CUDA driver (real)",
                stderr: "ggml_cuda_init: CUDA driver version is insufficient for CUDA runtime version",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "Metal unsupported on system (real)",
                stderr: "ggml_metal_init: error: Metal is not supported on this system",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "Vulkan no devices found (real)",
                stderr: "ggml_vulkan: No devices found.",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "Vulkan version too old (real)",
                stderr: "ggml_vulkan: Error: Vulkan 1.2 required.",
                expected: ErrorCode::DeviceInitFailed,
            },
            Case {
                name: "Metal command queue creation (real)",
                stderr: "ggml_metal_init: error: failed to create command queue",
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
            // Real upstream tensor-type validation (ggml/src/gguf.cpp).
            Case {
                name: "invalid ggml type (real)",
                stderr: "gguf_init_from_reader: tensor 'blk.0.ffn_down.weight' has invalid ggml type 39 (should be in [0, 39))",
                expected: ErrorCode::UnsupportedQuantization,
            },
            Case {
                name: "failed to quantize",
                stderr: "llama_model_quantize: failed to quantize tensor output.weight",
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
            // Real upstream gguf.cpp integrity errors.
            Case {
                name: "invalid magic characters (real)",
                stderr: "gguf_init_from_reader: invalid magic characters: 'abcd', expected 'GGUF'",
                expected: ErrorCode::ModelFileCorrupted,
            },
            Case {
                name: "failed to read tensor data (real)",
                stderr: "gguf_init_from_reader: failed to read tensor data\ngguf_init_from_file: failed to read GGUF data",
                expected: ErrorCode::ModelFileCorrupted,
            },
            Case {
                name: "unsupported GGUF version (real)",
                stderr: "gguf_init_from_reader: this GGUF file is version 4 but this software only supports up to version 3",
                expected: ErrorCode::ModelFileCorrupted,
            },
            // A path that cannot be opened is reported as unreadable, not
            // corrupt: the bytes may be fine, so re-downloading is wrong advice.
            Case {
                name: "failed to open GGUF file (real, missing path)",
                stderr: "gguf_init_from_file: failed to open GGUF file '/models/foo.gguf' (No such file or directory)",
                expected: ErrorCode::ModelFileNotFound,
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
            // Upstream llama-server wording (tools/server/server-http.cpp).
            Case {
                name: "couldn't bind HTTP socket (real)",
                stderr: "srv    start: couldn't bind HTTP server socket, hostname: 127.0.0.1, port: 8080",
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

    /// Guards against over-eager matching. Production hands `from_stderr` the
    /// whole accumulated stderr buffer, which on macOS always opens with the
    /// `load_backend:` banner naming `.dylib` paths under `.../Library/...`.
    /// A benign or unrelated tail must NOT be dressed up as a specific cause,
    /// because wrong remediation advice is worse than none.
    #[test]
    fn does_not_misclassify_benign_or_unrelated_output() {
        let template_miss = format!("{MACOS_BANNER}srv    load_model: chat template 'chatml' not found, falling back to default");
        let unknown_tail =
            format!("{MACOS_BANNER}srv    start: something entirely unexpected happened");
        let cases = [
            Case {
                name: "macOS banner + benign template miss",
                stderr: &template_miss,
                expected: ErrorCode::LlamaCppProcessError,
            },
            Case {
                name: "macOS banner + unclassified tail",
                stderr: &unknown_tail,
                expected: ErrorCode::LlamaCppProcessError,
            },
            Case {
                name: "empty stderr",
                stderr: "",
                expected: ErrorCode::LlamaCppProcessError,
            },
            Case {
                name: "whitespace-only stderr",
                stderr: "   \n\t\n",
                expected: ErrorCode::LlamaCppProcessError,
            },
            // A model file we cannot read is neither a port nor a corruption
            // problem - it must not tell the user to free a port or re-download.
            Case {
                name: "model file permission denied",
                stderr: "llama_model_load: failed to open '/models/m.gguf': Permission denied",
                expected: ErrorCode::ModelFileNotFound,
            },
            // Informational k-quant lines appear during healthy loads.
            Case {
                name: "informational k-quant line is not a quantization failure",
                stderr: "llama_model_loader: using k-quants for output.weight\nsrv    start: unexpected internal state",
                expected: ErrorCode::LlamaCppProcessError,
            },
        ];
        assert_classifies(&cases);
    }

    /// `details` must reach the frontend through the `Result<_, String>` IPC
    /// path, which stringifies the error via `Display`. Locks the multi-line
    /// case, since `{details:?}` escapes newlines.
    #[test]
    fn display_carries_multiline_details_and_none() {
        let multi = LlamacppError::from_stderr(
            "dyld[1]: Library not loaded: /x/libssl.dylib\nReason: code signature not valid",
        );
        let shown = multi.to_string();
        assert!(
            shown.contains("Library not loaded") && shown.contains("code signature not valid"),
            "both stderr lines must survive Display, got: {shown}"
        );
        assert!(
            shown.contains("\\n"),
            "newlines are Debug-escaped by {{details:?}}, got: {shown}"
        );

        let none = LlamacppError::new(ErrorCode::InternalError, "boom".into(), None);
        assert!(
            none.to_string().contains("details: None"),
            "the None branch must still render, got: {}",
            none.to_string()
        );
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
