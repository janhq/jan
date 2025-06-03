use std::collections::HashMap;
use serde_json::Value;
use chrono::{DateTime, Utc};

/// Information about a data source in the RAG system
#[derive(Clone, Debug, serde::Serialize)]
pub struct SourceInfo {
    pub id: String,
    pub source_id: String,
    pub r#type: String,
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
#[derive(Clone, Debug)]
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
#[derive(Clone, Debug, serde::Serialize)]
pub struct QueryResult {
    pub content: String,
    pub source_id: String,
    pub score: f32,
    pub chunk_id: String,
    pub metadata: Option<HashMap<String, Value>>,
}

/// Configuration for text chunking
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ChunkingConfig {
    pub chunk_size: usize,
    pub overlap: usize,
}

impl Default for ChunkingConfig {
    fn default() -> Self {
        Self {
            chunk_size: 1000,
            overlap: 100,
        }
    }
}

/// Parameters for adding a data source
#[derive(Clone, Debug)]
pub struct AddSourceParams {
    pub source_type: String,
    pub path: String,
    pub content: String,
    pub metadata: Option<HashMap<String, Value>>,
}

/// Parameters for querying documents
#[derive(Clone, Debug)]
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
#[derive(Clone, Debug, serde::Serialize)]
pub struct AddSourceResult {
    pub status: String,
    pub source_id: String,
    pub message: String,
    pub chunk_count: usize,
}

/// Result of cleaning data sources
#[derive(Clone, Debug, serde::Serialize)]
pub struct CleanResult {
    pub status: String,
    pub message: String,
    pub sources_removed: usize,
    pub chunks_removed: usize,
    pub timestamp: String,
}