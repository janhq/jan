use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    BinaryNotFound,
    ModelFileNotFound,
    ModelLoadFailed,
    ModelLoadTimedOut,
    OutOfMemory,
    ModelArchNotSupported,
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
    ///
    /// MLX runs on Apple Silicon (Metal) where weights + KV cache must fit in
    /// *unified* memory; on the common 16 GB / 24 GB Macs a large model OOMs at
    /// load time. The Metal/MLX allocator's wording varies, so we match the
    /// allocator-specific signatures in addition to the generic ones (cf.
    /// `tauri-plugin-llamacpp::LlamacppError::from_stderr`). Without this, a
    /// Metal allocation failure fell through to the opaque `MlxProcessError`
    /// instead of the actionable `OutOfMemory` the UI surfaces a clear toast
    /// for (ATO-186).
    pub fn from_stderr(stderr: &str) -> Self {
        let lower_stderr = stderr.to_lowercase();

        let is_out_of_memory = lower_stderr.contains("out of memory")
            || lower_stderr.contains("failed to allocate")
            || lower_stderr.contains("insufficient memory")
            || lower_stderr.contains("metal::malloc") // MLX Metal allocator throw
            || lower_stderr.contains("maximum allowed buffer size")
            || lower_stderr.contains("recommended max working set size")
            || lower_stderr.contains("recommended working set size")
            || lower_stderr.contains("kiogpucommandbuffercallbackerroroutofmemory") // Metal error code
            || lower_stderr.contains("erroroutofdevicememory"); // generic GPU OOM code

        if is_out_of_memory {
            return Self::new(
                ErrorCode::OutOfMemory,
                "Out of memory. The model requires more memory than is available on this device."
                    .into(),
                Some(stderr.into()),
            );
        }

        // The bundled mlx-vlm fork doesn't support this model's architecture
        // yet (e.g. a brand-new arch before the sidecar is bumped — cross-ref
        // ATO-135). mlx-vlm's resolver raises a clear "Model type X not
        // supported" / fails to import its model module, while a partial arch
        // mismatch surfaces as a missing-tensor crash (e.g. `switch_mlp`).
        // Surface an actionable message instead of the opaque process error.
        let is_unsupported_arch = (lower_stderr.contains("model type")
            && lower_stderr.contains("not supported"))
            || lower_stderr.contains("unknown model type")
            || lower_stderr.contains("no module named 'mlx_vlm.models")
            || lower_stderr.contains("no module named 'mlx_vlm.speculative.drafters")
            || lower_stderr.contains("switch_mlp");

        if is_unsupported_arch {
            return Self::new(
                ErrorCode::ModelArchNotSupported,
                "This model's architecture isn't supported by the current MLX backend yet.".into(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_generic_out_of_memory() {
        let err = MlxError::from_stderr("RuntimeError: out of memory");
        assert!(matches!(err.code, ErrorCode::OutOfMemory));
    }

    #[test]
    fn classifies_metal_allocator_oom() {
        // mlx raises this when a buffer doesn't fit in unified memory.
        let stderr = "libc++abi: terminating due to uncaught exception of type \
std::runtime_error: [metal::malloc] Attempting to allocate 18253611008 bytes which is \
greater than the maximum allowed buffer size of 17179869184 bytes.";
        let err = MlxError::from_stderr(stderr);
        assert!(matches!(err.code, ErrorCode::OutOfMemory));
    }

    #[test]
    fn classifies_metal_command_buffer_oom() {
        let stderr = "[METAL] Command buffer execution failed: Insufficient Memory \
(00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)";
        let err = MlxError::from_stderr(stderr);
        assert!(matches!(err.code, ErrorCode::OutOfMemory));
    }

    #[test]
    fn classifies_unsupported_model_type() {
        let stderr = "ValueError: Model type lfm2_moe not supported.";
        let err = MlxError::from_stderr(stderr);
        assert!(matches!(err.code, ErrorCode::ModelArchNotSupported));
    }

    #[test]
    fn classifies_missing_model_module() {
        let stderr = "Model type gemma4_unified not supported. Error: No module named \
'mlx_vlm.speculative.drafters.gemma4_unified'";
        let err = MlxError::from_stderr(stderr);
        // OOM is checked first; this is arch-not-supported, not OOM.
        assert!(matches!(err.code, ErrorCode::ModelArchNotSupported));
    }

    #[test]
    fn classifies_missing_tensor_crash() {
        let stderr = "KeyError: 'model.layers.0.feed_forward.switch_mlp.gate_proj.weight'";
        let err = MlxError::from_stderr(stderr);
        assert!(matches!(err.code, ErrorCode::ModelArchNotSupported));
    }

    #[test]
    fn falls_back_to_generic_process_error() {
        let err = MlxError::from_stderr("Traceback (most recent call last): ...");
        assert!(matches!(err.code, ErrorCode::MlxProcessError));
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
