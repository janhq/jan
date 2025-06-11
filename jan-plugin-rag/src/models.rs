// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Data models for the RAG plugin.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use serde_json::Value;
use chrono::{DateTime, Utc};

/// Information about a data source in the RAG system
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceInfo {
    pub id: String,
    pub source_id: String,
    #[serde(rename = "type")]
    pub source_type: String,
    pub name: String,
    pub path: String,
    pub filename: String,
    pub file_type: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub added_at: DateTime<Utc>,
    pub metadata: Option<HashMap<String, Value>>,
    pub chunk_count: usize,
    pub file_size: u64,
    pub error_message: Option<String>,
}

/// A chunk of text with its vector embedding
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DocumentChunk {
    pub id: String,
    pub source_id: String,
    pub text_chunk: String,
    pub vector: Vec<f32>,
    pub original_document_path: String,
    pub document_type: String,
    pub chunk_order: i32,
}

/// Result from a vector similarity search query
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub content: String,
    pub source_id: String,
    pub score: f32,
    pub chunk_id: String,
    pub metadata: Option<HashMap<String, Value>>,
}

/// Parameters for adding a data source
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AddSourceParams {
    pub source_type: String,
    pub path: String,
    pub content: String,
    pub metadata: Option<HashMap<String, Value>>,
}

/// Parameters for querying documents
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueryParams {
    pub query_text: String,
    pub top_k: usize,
    pub filters: Option<HashMap<String, String>>,
}

impl Default for QueryParams {
    fn default() -> Self {
        Self {
            query_text: String::new(),
            top_k: 3,
            filters: None,
        }
    }
}

/// Result of adding a data source
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AddSourceResult {
    pub status: String,
    pub source_id: String,
    pub message: String,
    pub chunk_count: usize,
}

/// Result of cleaning data sources
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CleanResult {
    pub status: String,
    pub message: String,
    pub sources_removed: usize,
    pub chunks_removed: usize,
    pub timestamp: String,
}

/// Status information for the RAG system
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RAGStatus {
    pub initialized: bool,
    pub database_path: Option<String>,
    pub embedding_model: String,
    pub chunk_count: usize,
    pub source_count: usize,
    pub last_updated: Option<DateTime<Utc>>,
}

/// Request to update embedding configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateEmbeddingConfigRequest {
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub dimensions: Option<usize>,
    pub batch_size: Option<usize>,
}

/// Request to update chunking configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateChunkingConfigRequest {
    pub chunk_size: Option<usize>,
    pub overlap: Option<usize>,
}

/// Response for configuration updates
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConfigUpdateResponse {
    pub status: String,
    pub message: String,
}

impl SourceInfo {
    /// Create a new SourceInfo with default values
    pub fn new(
        id: String,
        source_type: String,
        name: String,
        path: String,
    ) -> Self {
        let now = Utc::now();
        let filename = std::path::Path::new(&path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let file_type = std::path::Path::new(&path)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        Self {
            id: id.clone(),
            source_id: id,
            source_type,
            name,
            path,
            filename,
            file_type,
            status: "pending".to_string(),
            created_at: now,
            updated_at: now,
            added_at: now,
            metadata: None,
            chunk_count: 0,
            file_size: 0,
            error_message: None,
        }
    }

    /// Mark the source as successfully indexed
    pub fn mark_indexed(mut self, chunk_count: usize, file_size: u64) -> Self {
        self.status = "indexed".to_string();
        self.chunk_count = chunk_count;
        self.file_size = file_size;
        self.updated_at = Utc::now();
        self
    }

    /// Mark the source as failed with an error message
    pub fn mark_failed(mut self, error: String) -> Self {
        self.status = "failed".to_string();
        self.error_message = Some(error);
        self.updated_at = Utc::now();
        self
    }
}

impl DocumentChunk {
    /// Create a new DocumentChunk
    pub fn new(
        id: String,
        source_id: String,
        text_chunk: String,
        vector: Vec<f32>,
        original_document_path: String,
        document_type: String,
        chunk_order: i32,
    ) -> Self {
        Self {
            id,
            source_id,
            text_chunk,
            vector,
            original_document_path,
            document_type,
            chunk_order,
        }
    }
}

impl QueryResult {
    /// Create a new QueryResult
    pub fn new(
        content: String,
        source_id: String,
        score: f32,
        chunk_id: String,
        metadata: Option<HashMap<String, Value>>,
    ) -> Self {
        Self {
            content,
            source_id,
            score,
            chunk_id,
            metadata,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_info_creation() {
        let source = SourceInfo::new(
            "test-id".to_string(),
            "file".to_string(),
            "test.txt".to_string(),
            "/path/to/test.txt".to_string(),
        );
        
        assert_eq!(source.id, "test-id");
        assert_eq!(source.source_type, "file");
        assert_eq!(source.filename, "test.txt");
        assert_eq!(source.file_type, "txt");
        assert_eq!(source.status, "pending");
    }

    #[test]
    fn test_source_info_mark_indexed() {
        let source = SourceInfo::new(
            "test-id".to_string(),
            "file".to_string(),
            "test.txt".to_string(),
            "/path/to/test.txt".to_string(),
        );
        
        let indexed_source = source.mark_indexed(5, 1024);
        
        assert_eq!(indexed_source.status, "indexed");
        assert_eq!(indexed_source.chunk_count, 5);
        assert_eq!(indexed_source.file_size, 1024);
    }

    #[test]
    fn test_query_params_default() {
        let params = QueryParams::default();
        assert_eq!(params.top_k, 3);
        assert!(params.query_text.is_empty());
        assert!(params.filters.is_none());
    }

    #[test]
    fn test_serialization() {
        let source = SourceInfo::new(
            "test-id".to_string(),
            "file".to_string(),
            "test.txt".to_string(),
            "/path/to/test.txt".to_string(),
        );
        
        let serialized = serde_json::to_string(&source).unwrap();
        let deserialized: SourceInfo = serde_json::from_str(&serialized).unwrap();
        
        assert_eq!(source.id, deserialized.id);
        assert_eq!(source.source_type, deserialized.source_type);
    }
}