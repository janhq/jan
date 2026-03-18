use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    BinaryNotFound,
    FoundationModelsUnavailable,
    ServerStartFailed,
    ServerStartTimedOut,
    ProcessError,
    IoError,
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
    pub fn new(code: ErrorCode, message: String, details: Option<String>) -> Self {
        Self {
            code,
            message,
            details,
        }
    }

    /// Interpret stderr output from the server binary and produce a descriptive error.
    pub fn from_stderr(stderr: &str) -> Self {
        let lower = stderr.to_lowercase();

        if lower.contains("device is not eligible")
            || lower.contains("devicenoteligible")
        {
            return Self::new(
                ErrorCode::FoundationModelsUnavailable,
                "This device is not eligible for Apple Intelligence.".into(),
                Some(stderr.into()),
            );
        }

        if lower.contains("apple intelligence is not enabled")
            || lower.contains("appleintelligencenotenabled")
        {
            return Self::new(
                ErrorCode::FoundationModelsUnavailable,
                "Apple Intelligence is not enabled. Please enable it in System Settings → Apple Intelligence & Siri.".into(),
                Some(stderr.into()),
            );
        }

        if lower.contains("model not ready") || lower.contains("modelnotready") {
            return Self::new(
                ErrorCode::FoundationModelsUnavailable,
                "The Foundation Model is still downloading or not yet ready. Please wait and try again.".into(),
                Some(stderr.into()),
            );
        }

        Self::new(
            ErrorCode::ProcessError,
            "The Foundation Models server encountered an unexpected error.".into(),
            Some(stderr.into()),
        )
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    FoundationModels(#[from] FoundationModelsError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
}

impl serde::Serialize for ServerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let err = match self {
            ServerError::FoundationModels(e) => e.clone(),
            ServerError::Io(e) => FoundationModelsError::new(
                ErrorCode::IoError,
                "An input/output error occurred.".into(),
                Some(e.to_string()),
            ),
            ServerError::Tauri(e) => FoundationModelsError::new(
                ErrorCode::InternalError,
                "A Tauri internal error occurred.".into(),
                Some(e.to_string()),
            ),
        };
        err.serialize(serializer)
    }
}

pub type ServerResult<T> = Result<T, ServerError>;
