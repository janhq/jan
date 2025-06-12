// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Main RAG system implementation.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::Value;
use chrono::Utc;

use crate::{
    config::{RAGConfig, EmbeddingConfig, ChunkingConfig},
    error::{Error, Result},
    models::{SourceInfo, QueryResult, DocumentChunk},
};

use super::{
    database::RAGDatabase,
    embeddings::EmbeddingsGenerator,
    text_processing::TextProcessor,
    document_extraction::extract_text_from_file,
};

/// Main RAG system that coordinates between database, text processing, and embeddings
#[derive(Clone)]
pub struct RAGSystem {
    database: Arc<Mutex<RAGDatabase>>,
    text_processor: Arc<Mutex<TextProcessor>>,
    config: Arc<Mutex<RAGConfig>>,
}

impl RAGSystem {
    /// Create a new RAG system with default configuration
    pub fn new() -> Self {
        let config = RAGConfig::default();
        Self::with_config(config)
    }

    /// Create a new RAG system with custom configuration
    pub fn with_config(config: RAGConfig) -> Self {
        log::info!("Creating RAG system with embedding configuration: base_url={}, model={}, dimensions={}",
            config.embedding_config.base_url,
            config.embedding_config.model,
            config.embedding_config.dimensions
        );
        
        let embeddings = EmbeddingsGenerator::with_config(config.embedding_config.clone());
        let database = RAGDatabase::new();
        let text_processor = TextProcessor::new(embeddings, config.chunking_config.clone());

        Self {
            database: Arc::new(Mutex::new(database)),
            text_processor: Arc::new(Mutex::new(text_processor)),
            config: Arc::new(Mutex::new(config)),
        }
    }

    /// Initialize the RAG system with database path
    pub async fn initialize(&mut self, db_path: Option<PathBuf>) -> Result<()> {
        let mut database = self.database.lock().await;
        database.initialize(db_path).await?;
        
        log::info!("RAG system initialized successfully");
        Ok(())
    }

    /// Initialize the RAG system database (for use from shared state)
    pub async fn initialize_database(&self, db_path: Option<PathBuf>) -> Result<()> {
        let mut database = self.database.lock().await;
        database.initialize(db_path).await?;
        
        log::info!("RAG system database initialized successfully");
        Ok(())
    }

    /// Get system status
    pub async fn get_status(&self) -> Result<String> {
        let database = self.database.lock().await;
        let status = database.get_status().await?;
        Ok(status)
    }

    /// Add a data source to the RAG system
    pub async fn add_data_source(
        &self,
        source_type: &str,
        path: &str,
        content: &str,
        metadata: Option<HashMap<String, Value>>,
    ) -> Result<String> {
        log::info!("=== ADD DATA SOURCE START ===");
        log::info!("Source type: {}, Path: {}, Content length: {}", source_type, path, content.len());
        
        let text_processor = self.text_processor.lock().await;
        
        // Extract text content if needed
        let final_content = self.extract_text_if_needed(content, source_type, path).await?;
        log::info!("Final content length: {} characters", final_content.len());
        
        // Generate source ID
        let source_id = text_processor.generate_id(path);
        log::info!("Generated source ID: {}", source_id);
        
        // Process content into chunks with embeddings
        let chunks = text_processor.process_content_to_chunks(&final_content, &source_id, path, source_type).await?;
        log::info!("Created {} chunks", chunks.len());
        
        if chunks.is_empty() {
            return Err(Error::text_processing("No chunks could be extracted from the content"));
        }

        // Get embedding dimension
        let embedding_dim = text_processor.embedding_dim().await;
        
        // Store chunks in database
        let database = self.database.lock().await;
        database.store_chunks(&chunks, embedding_dim).await?;
        log::info!("Successfully stored chunks");

        // Create and store source info
        let now = Utc::now();
        let filename = PathBuf::from(path).file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let file_extension = PathBuf::from(path).extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let source_info = SourceInfo {
            id: source_id.clone(),
            source_id: source_id.clone(),
            source_type: source_type.to_string(),
            name: filename.clone(),
            path: path.to_string(),
            filename,
            file_type: file_extension,
            status: "indexed".to_string(),
            created_at: now,
            updated_at: now,
            added_at: now,
            metadata,
            chunk_count: chunks.len(),
            file_size: final_content.len() as u64,
            error_message: None,
        };

        database.store_source(&source_info).await?;
        log::info!("Successfully stored source info");
        
        log::info!("=== ADD DATA SOURCE COMPLETE ===");
        Ok(source_id)
    }

    /// List all data sources
    pub async fn list_data_sources(&self) -> Result<Vec<SourceInfo>> {
        let database = self.database.lock().await;
        let sources = database.list_sources().await?;
        Ok(sources)
    }

    /// Remove a data source
    pub async fn remove_data_source(&self, source_id: &str) -> Result<bool> {
        let database = self.database.lock().await;
        let removed = database.remove_source(source_id).await?;
        Ok(removed)
    }

    /// Query documents using vector similarity search
    pub async fn query_documents(
        &self,
        query: &str,
        top_k: usize,
        filters: Option<HashMap<String, String>>,
    ) -> Result<Vec<QueryResult>> {
        log::info!("=== QUERY DOCUMENTS START ===");
        log::info!("Query: \"{}\", Top K: {}", query, top_k);
        
        // Generate embedding for query
        let text_processor = self.text_processor.lock().await;
        let query_embedding = text_processor.generate_query_embedding(query).await?;
        log::info!("Query embedding generated with dimension: {}", query_embedding.len());
        
        // Search in database
        let database = self.database.lock().await;
        let results = database.query_chunks(query_embedding, top_k, filters).await?;
        
        log::info!("Vector search returned {} results", results.len());
        log::info!("=== QUERY DOCUMENTS COMPLETE ===");
        Ok(results)
    }

    /// Clean all data sources
    pub async fn clean_all_data_sources(&self) -> Result<()> {
        let database = self.database.lock().await;
        database.clean_all().await?;
        Ok(())
    }

    /// Reset database (alias for clean_all_data_sources)
    pub async fn reset_database(&self) -> Result<()> {
        self.clean_all_data_sources().await
    }

    /// Get the current embedding configuration
    pub async fn get_embedding_config(&self) -> Result<EmbeddingConfig> {
        let config = self.config.lock().await;
        Ok(config.embedding_config.clone())
    }

    /// Update the embedding configuration
    pub async fn update_embedding_config(&self, new_config: EmbeddingConfig) -> Result<()> {
        log::info!("Updating RAG embedding configuration: base_url={}, model={}", new_config.base_url, new_config.model);
        
        // Update the stored config
        {
            let mut config = self.config.lock().await;
            config.embedding_config = new_config.clone();
        }
        
        // Update the text processor with new embeddings generator
        let mut text_processor = self.text_processor.lock().await;
        let new_embeddings = EmbeddingsGenerator::with_config(new_config);
        let chunking_config = text_processor.get_chunking_config().clone();
        *text_processor = TextProcessor::new(new_embeddings, chunking_config);
        
        log::info!("RAG embedding configuration updated successfully");
        Ok(())
    }

    /// Get the current chunking configuration
    pub async fn get_chunking_config(&self) -> Result<ChunkingConfig> {
        let config = self.config.lock().await;
        Ok(config.chunking_config.clone())
    }

    /// Get the full RAG configuration
    pub async fn get_full_config(&self) -> Result<RAGConfig> {
        let config = self.config.lock().await;
        Ok(config.clone())
    }

    /// Update chunking configuration
    pub async fn update_chunking_config(&self, new_config: ChunkingConfig) -> Result<()> {
        // Update the stored config
        {
            let mut config = self.config.lock().await;
            config.chunking_config = new_config.clone();
        }
        
        // Update the text processor
        let mut text_processor = self.text_processor.lock().await;
        text_processor.update_chunking_config(new_config);
        
        log::info!("Chunking configuration updated");
        Ok(())
    }

    /// Extract text content from a file if content is empty
    async fn extract_text_if_needed(&self, content: &str, source_type: &str, path: &str) -> Result<String> {
        if content.is_empty() && source_type == "file" {
            log::info!("Extracting text from file: {}", path);
            let extracted = extract_text_from_file(path).await?;
            log::info!("Extracted {} characters from file", extracted.len());
            Ok(extracted)
        } else {
            Ok(content.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rag_system_creation() {
        let system = RAGSystem::new();
        let status = system.get_status().await;
        // Database not initialized, should return Ok with message
        assert!(status.is_ok());
        assert_eq!(status.unwrap(), "Database not initialized");
    }

    #[tokio::test]
    async fn test_rag_system_with_config() {
        let config = RAGConfig::default();
        let system = RAGSystem::with_config(config);
        
        let embedding_config = system.get_embedding_config().await.unwrap();
        assert_eq!(embedding_config.dimensions, 1536);
        
        let chunking_config = system.get_chunking_config().await.unwrap();
        assert_eq!(chunking_config.chunk_size, 1000);
    }

    #[tokio::test]
    async fn test_config_updates() {
        let system = RAGSystem::new();
        
        let new_embedding_config = EmbeddingConfig {
            base_url: "http://localhost:8080".to_string(),
            api_key: None,
            model: "test-model".to_string(),
            dimensions: 384,
            batch_size: 50,
        };
        
        let result = system.update_embedding_config(new_embedding_config.clone()).await;
        assert!(result.is_ok());
        
        let updated_config = system.get_embedding_config().await.unwrap();
        assert_eq!(updated_config.base_url, "http://localhost:8080");
        assert_eq!(updated_config.dimensions, 384);
    }
}