use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum VectorDBError {
    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

impl From<rusqlite::Error> for VectorDBError {
    fn from(err: rusqlite::Error) -> Self {
        VectorDBError::DatabaseError(err.to_string())
    }
}

impl From<serde_json::Error> for VectorDBError {
    fn from(err: serde_json::Error) -> Self {
        VectorDBError::DatabaseError(err.to_string())
    }
}

