// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Error types for the RAG plugin.

use serde::{Deserialize, Serialize};
use tauri::ipc::InvokeError;

/// Result type alias for the RAG plugin.
pub type Result<T> = std::result::Result<T, Error>;

/// Error types for the RAG plugin.
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum Error {
    /// Database initialization or operation error
    #[error("Database error: {0}")]
    Database(String),
    
    /// Embedding generation error
    #[error("Embedding error: {0}")]
    Embedding(String),
    
    /// Text processing error
    #[error("Text processing error: {0}")]
    TextProcessing(String),
    
    /// Document parsing error
    #[error("Document parsing error: {0}")]
    DocumentParsing(String),
    
    /// Configuration error
    #[error("Configuration error: {0}")]
    Configuration(String),
    
    /// Network/HTTP error
    #[error("Network error: {0}")]
    Network(String),
    
    /// File system error
    #[error("File system error: {0}")]
    FileSystem(String),
    
    /// Serialization/deserialization error
    #[error("Serialization error: {0}")]
    Serialization(String),
    
    /// Invalid input error
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    
    /// Resource not found error
    #[error("Resource not found: {0}")]
    NotFound(String),
    
    /// Internal error
    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<anyhow::Error> for Error {
    fn from(err: anyhow::Error) -> Self {
        Error::Internal(err.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Error::FileSystem(err.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::Serialization(err.to_string())
    }
}

impl From<reqwest::Error> for Error {
    fn from(err: reqwest::Error) -> Self {
        Error::Network(err.to_string())
    }
}

impl From<lancedb::Error> for Error {
    fn from(err: lancedb::Error) -> Self {
        Error::Database(err.to_string())
    }
}

impl From<arrow_schema::ArrowError> for Error {
    fn from(err: arrow_schema::ArrowError) -> Self {
        Error::Database(format!("Arrow error: {}", err))
    }
}

impl Error {
    /// Create a database error.
    pub fn database<T: std::fmt::Display>(msg: T) -> Self {
        Error::Database(msg.to_string())
    }
    
    /// Create an embedding error.
    pub fn embedding<T: std::fmt::Display>(msg: T) -> Self {
        Error::Embedding(msg.to_string())
    }
    
    /// Create a text processing error.
    pub fn text_processing<T: std::fmt::Display>(msg: T) -> Self {
        Error::TextProcessing(msg.to_string())
    }
    
    /// Create a document parsing error.
    pub fn document_parsing<T: std::fmt::Display>(msg: T) -> Self {
        Error::DocumentParsing(msg.to_string())
    }
    
    /// Create a configuration error.
    pub fn configuration<T: std::fmt::Display>(msg: T) -> Self {
        Error::Configuration(msg.to_string())
    }
    
    /// Create an invalid input error.
    pub fn invalid_input<T: std::fmt::Display>(msg: T) -> Self {
        Error::InvalidInput(msg.to_string())
    }
    
    /// Create a not found error.
    pub fn not_found<T: std::fmt::Display>(msg: T) -> Self {
        Error::NotFound(msg.to_string())
    }
    
    /// Create an internal error.
    pub fn internal<T: std::fmt::Display>(msg: T) -> Self {
        Error::Internal(msg.to_string())
    }
    
    /// Create a network error.
    pub fn network<T: std::fmt::Display>(msg: T) -> Self {
        Error::Network(msg.to_string())
    }
    
    /// Create a file system error.
    pub fn file_system<T: std::fmt::Display>(msg: T) -> Self {
        Error::FileSystem(msg.to_string())
    }
    
    /// Create a serialization error.
    pub fn serialization<T: std::fmt::Display>(msg: T) -> Self {
        Error::Serialization(msg.to_string())
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_creation() {
        let err = Error::database("Test database error");
        assert!(matches!(err, Error::Database(_)));
        assert_eq!(err.to_string(), "Database error: Test database error");
    }

    #[test]
    fn test_error_from_anyhow() {
        let anyhow_err = anyhow::anyhow!("Test error");
        let err: Error = anyhow_err.into();
        assert!(matches!(err, Error::Internal(_)));
    }

    #[test]
    fn test_error_serialization() {
        let err = Error::embedding("Test embedding error");
        let serialized = serde_json::to_string(&err).unwrap();
        let deserialized: Error = serde_json::from_str(&serialized).unwrap();
        assert!(matches!(deserialized, Error::Embedding(_)));
    }
}