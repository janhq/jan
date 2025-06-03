use anyhow::{Result, anyhow};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::Value;
use chrono::Utc;

use super::types::{SourceInfo, QueryResult, AddSourceParams, QueryParams, ChunkingConfig};
use super::database::RAGDatabase;
use super::text_processing::TextProcessor;
use super::embeddings::EmbeddingsGenerator;
use crate::core::cmd::{get_jan_data_folder_path, get_app_configurations, EmbeddingConfig};
use tauri::{AppHandle, Runtime};

/// Main RAG system that coordinates between database, text processing, and embeddings
#[derive(Clone)]
pub struct RAGSystem {
    database: Arc<Mutex<RAGDatabase>>,
    text_processor: Arc<Mutex<TextProcessor>>,
}

// Global RAG system instance
static RAG_SYSTEM: tokio::sync::OnceCell<Arc<Mutex<RAGSystem>>> = tokio::sync::OnceCell::const_new();
static RAG_SYSTEM_WITH_APP: tokio::sync::OnceCell<Arc<Mutex<RAGSystem>>> = tokio::sync::OnceCell::const_new();

impl RAGSystem {
    /// Create a new RAG system with default configuration
    pub fn new() -> Self {
        let embeddings = EmbeddingsGenerator::new();
        let database = RAGDatabase::new();
        let text_processor = TextProcessor::new(embeddings);

        Self {
            database: Arc::new(Mutex::new(database)),
            text_processor: Arc::new(Mutex::new(text_processor)),
        }
    }

    /// Create a new RAG system with custom embedding configuration
    pub fn with_config(embedding_config: EmbeddingConfig) -> Self {
        log::info!("Creating RAG system with embedding configuration: base_url={}, model={}, dimensions={}",
            embedding_config.base_url,
            embedding_config.model,
            embedding_config.dimensions
        );
        
        let embeddings = EmbeddingsGenerator::with_config(embedding_config);
        let database = RAGDatabase::new();
        let text_processor = TextProcessor::new(embeddings);

        Self {
            database: Arc::new(Mutex::new(database)),
            text_processor: Arc::new(Mutex::new(text_processor)),
        }
    }

    /// Initialize the RAG system with database path
    pub async fn initialize(&mut self, db_path: Option<PathBuf>) -> Result<()> {
        let mut database = self.database.lock().await;
        database.initialize(db_path).await?;
        
        log::info!("RAG system initialized successfully");
        Ok(())
    }

    /// Get system status
    pub async fn get_status(&self) -> Result<String> {
        let database = self.database.lock().await;
        database.get_status().await
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
        let final_content = text_processor.extract_text_if_needed(content, source_type, path).await?;
        log::info!("Final content length: {} characters", final_content.len());
        
        // Generate source ID
        let source_id = text_processor.generate_id(path);
        log::info!("Generated source ID: {}", source_id);
        
        // Process content into chunks with embeddings
        let chunks = text_processor.process_content_to_chunks(&final_content, &source_id, path, source_type).await?;
        log::info!("Created {} chunks", chunks.len());
        
        if chunks.is_empty() {
            return Err(anyhow!("No chunks could be extracted from the content"));
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
            r#type: source_type.to_string(),
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
        database.list_sources().await
    }

    /// Remove a data source
    pub async fn remove_data_source(&self, source_id: &str) -> Result<bool> {
        let database = self.database.lock().await;
        database.remove_source(source_id).await
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
        database.clean_all().await
    }

    /// Reset database (alias for clean_all_data_sources)
    pub async fn reset_database(&self) -> Result<()> {
        self.clean_all_data_sources().await
    }

    /// Update the embedding configuration
    pub async fn update_embedding_config(&self, config: EmbeddingConfig) -> Result<()> {
        log::info!("Updating RAG embedding configuration: base_url={}, model={}", config.base_url, config.model);
        let mut text_processor = self.text_processor.lock().await;
        
        // Create new embeddings generator with updated config
        let new_embeddings = EmbeddingsGenerator::with_config(config);
        *text_processor = TextProcessor::new(new_embeddings);
        
        log::info!("RAG embedding configuration updated successfully");
        Ok(())
    }

    /// Update chunking configuration
    pub async fn update_chunking_config(&self, config: ChunkingConfig) -> Result<()> {
        let mut text_processor = self.text_processor.lock().await;
        text_processor.update_chunking_config(config);
        log::info!("Chunking configuration updated");
        Ok(())
    }
}

// Global system management functions

/// Get the global RAG system instance with app handle
pub async fn get_rag_system_with_app<R: Runtime>(app_handle: AppHandle<R>) -> Arc<Mutex<RAGSystem>> {
    RAG_SYSTEM_WITH_APP.get_or_init(|| async {
        // Get embedding configuration from app configuration
        let app_config = get_app_configurations(app_handle.clone());
        let embedding_config = app_config.embedding_config;
        
        log::info!("Initializing RAG system with embedding config: base_url={}, api_key_present={}, model={}",
            embedding_config.base_url,
            embedding_config.api_key.is_some(),
            embedding_config.model);
        
        Arc::new(Mutex::new(RAGSystem::with_config(embedding_config)))
    }).await.clone()
}

/// Get the global RAG system instance (fallback for cases without app handle)
/// This will try to use the app-configured system first, then fall back to default
pub async fn get_rag_system() -> Arc<Mutex<RAGSystem>> {
    // First try to get the app-configured system if it exists
    if let Some(app_system) = RAG_SYSTEM_WITH_APP.get() {
        return app_system.clone();
    }
    
    // Fall back to default system
    RAG_SYSTEM.get_or_init(|| async {
        log::warn!("Using default RAG system configuration - app configuration not available");
        Arc::new(Mutex::new(RAGSystem::new()))
    }).await.clone()
}

/// Initialize the global RAG system with app handle
pub async fn initialize_rag_system_with_app<R: Runtime>(app_handle: AppHandle<R>) -> Result<()> {
    let rag_system = get_rag_system_with_app(app_handle.clone()).await;
    let mut system = rag_system.lock().await;
    
    // Use Jan's data folder for the database
    let jan_data_path = get_jan_data_folder_path(app_handle);
    let db_path = Some(jan_data_path.join("rag_db"));
    
    system.initialize(db_path).await
}

/// Initialize the global RAG system (fallback for cases without app handle)
pub async fn initialize_rag_system() -> Result<()> {
    let rag_system = get_rag_system().await;
    let mut system = rag_system.lock().await;
    
    // Fallback to default database path
    let db_path = dirs::home_dir()
        .map(|home| home.join(".jan").join("rag_db"));
    
    system.initialize(db_path).await
}

/// Update the global RAG system with embedding configuration
pub async fn update_global_embedding_config(config: EmbeddingConfig) -> Result<()> {
    // Update app-configured system if it exists
    if let Some(app_system) = RAG_SYSTEM_WITH_APP.get() {
        let system = app_system.lock().await;
        system.update_embedding_config(config).await?;
        log::info!("Updated app-configured RAG system with new embedding config");
        return Ok(());
    }
    
    // Update default system if app system doesn't exist
    if let Some(default_system) = RAG_SYSTEM.get() {
        let system = default_system.lock().await;
        system.update_embedding_config(config).await?;
        log::info!("Updated default RAG system with new embedding config");
        return Ok(());
    }
    
    log::warn!("No RAG system instance found to update");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rag_system_creation() {
        let system = RAGSystem::new();
        let status = system.get_status().await;
        assert!(status.is_ok());
    }

    #[tokio::test]
    async fn test_chunking_config_update() {
        let mut system = RAGSystem::new();
        let new_config = ChunkingConfig {
            chunk_size: 500,
            overlap: 50,
        };
        
        let result = system.update_chunking_config(new_config).await;
        assert!(result.is_ok());
    }
}