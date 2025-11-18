use serde::{Deserialize, Serialize};
use thiserror;

#[derive(Debug, Clone, Serialize, Deserialize)]
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
        Self::new(
            ErrorCode::LlamaCppProcessError,
            "The model process encountered an unexpected error.".into(),
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
