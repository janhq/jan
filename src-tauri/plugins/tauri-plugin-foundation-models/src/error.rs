use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotLoaded,
    Unavailable,
    InvalidRequest,
    InferenceError,
    InternalError,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("FoundationModelsError {{ code: {code:?}, message: \"{message}\" }}")]
pub struct FoundationModelsError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl FoundationModelsError {
    pub fn not_loaded() -> Self {
        Self {
            code: ErrorCode::NotLoaded,
            message: "Foundation Models are not loaded. Please load the model first.".into(),
            details: None,
        }
    }

    pub fn unavailable(details: String) -> Self {
        Self {
            code: ErrorCode::Unavailable,
            message: "Foundation Models are not available on this device.".into(),
            details: Some(details),
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    pub fn invalid_request(details: String) -> Self {
        Self {
            code: ErrorCode::InvalidRequest,
            message: "Invalid request.".into(),
            details: Some(details),
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    pub fn inference_error(details: String) -> Self {
        Self {
            code: ErrorCode::InferenceError,
            message: "An error occurred during inference.".into(),
            details: Some(details),
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    pub fn internal_error(details: String) -> Self {
        Self {
            code: ErrorCode::InternalError,
            message: "An internal error occurred.".into(),
            details: Some(details),
        }
    }
}
