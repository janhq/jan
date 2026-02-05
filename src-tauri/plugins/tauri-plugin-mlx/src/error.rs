use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    BinaryNotFound,
    ModelFileNotFound,
    ModelLoadFailed,
    ModelLoadTimedOut,
    OutOfMemory,
    MlxProcessError,
    IoError,
    InternalError,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("MlxError {{ code: {code:?}, message: \"{message}\" }}")]
pub struct MlxError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl MlxError {
    pub fn new(code: ErrorCode, message: String, details: Option<String>) -> Self {
        Self {
            code,
            message,
            details,
        }
    }

    /// Parses stderr from the MLX server and creates a specific MlxError.
    pub fn from_stderr(stderr: &str) -> Self {
        let lower_stderr = stderr.to_lowercase();

        if lower_stderr.contains("out of memory")
            || lower_stderr.contains("failed to allocate")
            || lower_stderr.contains("insufficient memory")
        {
            return Self::new(
                ErrorCode::OutOfMemory,
                "Out of memory. The model requires more RAM than available.".into(),
                Some(stderr.into()),
            );
        }

        Self::new(
            ErrorCode::MlxProcessError,
            "The MLX model process encountered an unexpected error.".into(),
            Some(stderr.into()),
        )
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    Mlx(#[from] MlxError),

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
        let error_to_serialize: MlxError = match self {
            ServerError::Mlx(err) => err.clone(),
            ServerError::Io(e) => MlxError::new(
                ErrorCode::IoError,
                "An input/output error occurred.".into(),
                Some(e.to_string()),
            ),
            ServerError::Tauri(e) => MlxError::new(
                ErrorCode::InternalError,
                "An internal application error occurred.".into(),
                Some(e.to_string()),
            ),
        };
        error_to_serialize.serialize(serializer)
    }
}

pub type ServerResult<T> = Result<T, ServerError>;
