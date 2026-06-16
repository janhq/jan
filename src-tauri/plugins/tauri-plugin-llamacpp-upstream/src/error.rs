use serde::{Deserialize, Serialize};
use thiserror;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    BinaryNotFound,
    ModelFileNotFound,
    ModelFileCorrupt,
    LibraryPathInvalid,

    // --- Model Loading Errors ---
    ModelLoadFailed,
    DraftModelLoadFailed,
    MultimodalProjectorLoadFailed,
    ModelArchNotSupported,
    ModelLoadTimedOut,
    LlamaCppProcessError,

    // --- System / Runtime Compatibility Errors ---
    OsVersionUnsupported,

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
#[error("LlamacppError {{ code: {code:?}, message: \"{message}\" }}")]
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
    pub fn from_stderr(stderr: &str) -> Self {
        let lower_stderr = stderr.to_lowercase();

        // The bundled macOS `llama-server` is built against a recent macOS SDK
        // and links Metal symbols (e.g. the Objective-C class
        // `MTLResidencySetDescriptor`) that only exist on newer macOS runtimes.
        // On an older macOS (e.g. 10.15.7 Catalina) the dynamic linker cannot
        // resolve the symbol and aborts the process at load time
        // (`dyld[...]: Symbol not found: _OBJC_CLASS_$_MTLResidencySetDescriptor`),
        // before any model load argument is read — so a CPU fallback within the
        // same binary is impossible. Classify this as an unsupported-OS error so
        // the caller can show an actionable "update macOS" message instead of an
        // opaque "unexpected error", and so the auto-start loop stops retrying a
        // permanently-failing load.
        if lower_stderr.contains("dyld") && lower_stderr.contains("symbol not found") {
            return Self::new(
                ErrorCode::OsVersionUnsupported,
                "The model engine couldn't start because it requires a newer version of macOS than the one on this Mac.".into(),
                Some(stderr.into()),
            );
        }

        // TODO: add others
        let is_out_of_memory = lower_stderr.contains("out of memory")
            || lower_stderr.contains("failed to allocate")
            || lower_stderr.contains("insufficient memory")
            || lower_stderr.contains("erroroutofdevicememory") // vulkan specific
            || lower_stderr.contains("kiogpucommandbuffercallbackerroroutofmemory") // Metal-specific error code
            || lower_stderr.contains("cuda_error_out_of_memory"); // CUDA-specific

        if is_out_of_memory {
            return Self::new(
                ErrorCode::OutOfMemory,
                "Out of memory. The model requires more RAM or VRAM than available.".into(),
                Some(stderr.into()),
            );
        }

        if lower_stderr.contains("error loading model architecture") {
            return Self::new(
                ErrorCode::ModelArchNotSupported,
                "The model's architecture is not supported by this version of the backend.".into(),
                Some(stderr.into()),
            );
        }

        // The multimodal projector (mmproj) declares a projector type the
        // bundled llama.cpp/libmtmd build cannot build a graph for (e.g. the
        // brand-new Gemma 4 `gemma4a` audio projector). libmtmd calls
        // `ggml_abort` during clip warmup ("clip.cpp:NNNN: Unknown projector
        // type"), taking down the whole llama-server with SIGABRT before the
        // server reports ready. Surface this as an actionable, recoverable
        // error so the caller can retry the load text-only (without --mmproj).
        if lower_stderr.contains("unknown projector type") {
            return Self::new(
                ErrorCode::MultimodalProjectorLoadFailed,
                "This model's multimodal projector isn't supported by the current llama.cpp backend. Vision/audio is unavailable for this model on this backend.".into(),
                Some(stderr.into()),
            );
        }

        // A truncated or corrupt GGUF (interrupted download, bad disk write).
        // llama.cpp's loader emits these when tensor data runs past the file
        // bounds, the header magic is wrong, or the tensor count mismatches.
        // Point the user at a re-download instead of the opaque generic error.
        if lower_stderr.contains("corrupted or incomplete")
            || lower_stderr.contains("invalid magic")
            || lower_stderr.contains("wrong number of tensors")
            || lower_stderr.contains("unexpectedly reached end of file")
            || lower_stderr.contains("failed to read tensor")
        {
            return Self::new(
                ErrorCode::ModelFileCorrupt,
                "The model file appears to be incomplete or corrupted. Try deleting and re-downloading the model.".into(),
                Some(stderr.into()),
            );
        }

        Self::new(
            ErrorCode::LlamaCppProcessError,
            "The model process encountered an unexpected error.".into(),
            Some(stderr.into()),
        )
    }

    /// Classify a non-success process exit. Native crashes (Windows access
    /// violation `0xC0000005`, stack overflow / buffer overrun; Unix `SIGSEGV` /
    /// `SIGABRT`) usually leave empty stderr, so `from_stderr` alone would only
    /// yield the opaque generic process error. When stderr already pins a
    /// specific cause (OOM, arch, projector) we keep it; otherwise, for a
    /// recognised crash we surface an actionable hint.
    pub fn from_exit_status(status: &std::process::ExitStatus, stderr: &str) -> Self {
        let base = Self::from_stderr(stderr);
        if !matches!(base.code, ErrorCode::LlamaCppProcessError) || !is_crash_exit(status) {
            return base;
        }
        Self::new(
            ErrorCode::LlamaCppProcessError,
            "The model process crashed unexpectedly (access violation / segfault). \
This usually means the model is incompatible with this backend, or its \
speculative-decoding (MTP) configuration is unsupported here."
                .into(),
            Some(stderr.into()),
        )
    }
}

/// Whether a process exit status is a hard native crash (access violation /
/// segmentation fault) rather than a normal non-zero exit, so it can be given
/// an actionable message instead of an opaque "unexpected error".
fn is_crash_exit(status: &std::process::ExitStatus) -> bool {
    #[cfg(windows)]
    {
        matches!(status.code(), Some(code) if {
            let c = code as u32;
            // STATUS_ACCESS_VIOLATION / STATUS_STACK_OVERFLOW / STATUS_STACK_BUFFER_OVERRUN
            c == 0xC000_0005 || c == 0xC000_00FD || c == 0xC000_0409
        })
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        // SIGSEGV = 11, SIGABRT = 6
        matches!(status.signal(), Some(11 | 6))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = status;
        false
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
