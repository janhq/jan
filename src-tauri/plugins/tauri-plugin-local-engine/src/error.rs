use thiserror::Error;

pub type EngineResult<T> = Result<T, LocalEngineError>;

#[derive(Debug, Error)]
pub enum LocalEngineError {
    #[error("Unknown local engine: {0}")]
    UnknownEngine(String),

    #[error("Python interpreter not found for engine '{engine}'. Set {env_var} to a Python 3.10+ interpreter that has the '{package}' package installed.")]
    PythonNotFound { engine: String, env_var: String, package: String },

    #[error("Python interpreter '{path}' is not a file")]
    PythonNotAFile { path: String },

    #[error("Model path '{path}' does not exist")]
    ModelNotFound { path: String },

    #[error("Failed to start the engine server: {0}")]
    SpawnFailed(String),

    #[error("The engine server did not become ready within {timeout}s: {reason}")]
    NotReady { timeout: u64, reason: String },

    #[error("No running session for model '{0}'")]
    SessionNotFound(String),

    #[error("No running session with pid {0}")]
    SessionNotFoundByPid(i32),
}
