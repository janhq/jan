// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Configuration structures for the RAG plugin.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const RAG_CONFIGURATION_FILE_NAME: &str = "rag_settings.json";

/// Get the path to the RAG configuration file
pub fn get_rag_configuration_file_path<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    let mut path = app_handle.path().data_dir().unwrap();

    // Follow the same pattern as the main app's data folder
    let app_name = std::env::var("APP_NAME")
        .unwrap_or_else(|_| app_handle.config().product_name.clone().unwrap());
    
    path.push(app_name);
    path.push("data");

    let mut path_str = path.to_str().unwrap().to_string();

    // Strip .ai.app suffix if present
    if let Some(stripped) = path.to_str().unwrap().to_string().strip_suffix(".ai.app") {
        path_str = stripped.to_string();
    }

    PathBuf::from(path_str).join(RAG_CONFIGURATION_FILE_NAME)
}

/// Main configuration for the RAG plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RAGConfig {
    /// Database path for vector storage
    pub database_path: Option<PathBuf>,
    /// Embedding configuration
    pub embedding_config: EmbeddingConfig,
    /// Text chunking configuration
    pub chunking_config: ChunkingConfig,
}

impl Default for RAGConfig {
    fn default() -> Self {
        Self {
            database_path: None,
            embedding_config: EmbeddingConfig::default(),
            chunking_config: ChunkingConfig::default(),
        }
    }
}

/// Configuration for embedding generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingConfig {
    /// Base URL for the embedding API (OpenAI-compatible)
    pub base_url: String,
    /// API key for authentication (optional)
    pub api_key: Option<String>,
    /// Model name for embeddings
    pub model: String,
    /// Embedding vector dimensions
    pub dimensions: usize,
    /// Batch size for processing multiple texts
    pub batch_size: usize,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com".to_string(),
            api_key: None,
            model: "text-embedding-ada-002".to_string(),
            dimensions: 1536,
            batch_size: 100,
        }
    }
}

/// Configuration for text chunking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkingConfig {
    /// Size of each text chunk in characters
    pub chunk_size: usize,
    /// Overlap between chunks in characters
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

impl RAGConfig {
    /// Create a new configuration with custom settings.
    pub fn new(
        database_path: Option<PathBuf>,
        embedding_config: EmbeddingConfig,
        chunking_config: ChunkingConfig,
    ) -> Self {
        Self {
            database_path,
            embedding_config,
            chunking_config,
        }
    }

    /// Load configuration from file or create default
    pub fn load_from_file<R: Runtime>(app_handle: &AppHandle<R>) -> Self {
        let config_file_path = get_rag_configuration_file_path(app_handle);
        
        if !config_file_path.exists() {
            log::info!(
                "RAG config not found, creating default config at {:?}",
                config_file_path
            );
            
            let default_config = Self::default();
            if let Err(err) = default_config.save_to_file(app_handle) {
                log::error!("Failed to create default RAG config: {}", err);
            }
            
            return default_config;
        }

        match fs::read_to_string(&config_file_path) {
            Ok(content) => Self::parse_and_update_configuration(content, &config_file_path),
            Err(err) => {
                log::error!(
                    "Failed to read RAG config, returning default config instead. Error: {}",
                    err
                );
                Self::default()
            }
        }
    }

    /// Save configuration to file
    pub fn save_to_file<R: Runtime>(&self, app_handle: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
        let config_file_path = get_rag_configuration_file_path(app_handle);
        
        // Ensure parent directory exists
        if let Some(parent) = config_file_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        let content = serde_json::to_string_pretty(self)?;
        fs::write(config_file_path, content)?;
        
        log::info!("RAG configuration saved successfully");
        Ok(())
    }

    /// Parse configuration content and update missing fields
    fn parse_and_update_configuration(content: String, config_file_path: &PathBuf) -> Self {
        let default_config = Self::default();

        // Parse the JSON into a generic Value first to handle missing fields
        match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(mut json_value) => {
                // Merge missing fields with defaults
                Self::merge_missing_fields(&mut json_value);

                // Save the updated configuration back to file
                let updated_content = serde_json::to_string_pretty(&json_value).unwrap();
                if let Err(err) = fs::write(config_file_path, updated_content) {
                    log::error!("Failed to update RAG config with missing fields: {}", err);
                }

                // Now try to deserialize the updated JSON into RAGConfig
                match serde_json::from_value::<RAGConfig>(json_value) {
                    Ok(config) => config,
                    Err(err) => {
                        log::error!(
                            "Failed to parse RAG config after updating, returning default config instead. Error: {}",
                            err
                        );
                        default_config
                    }
                }
            }
            Err(err) => {
                log::error!(
                    "Failed to parse RAG config JSON, returning default config instead. Error: {}",
                    err
                );
                default_config
            }
        }
    }

    /// Merge missing fields from default configuration into existing JSON configuration
    fn merge_missing_fields(json_value: &mut serde_json::Value) {
        if let Some(obj) = json_value.as_object_mut() {
            let default_config = Self::default();

            // Handle database_path
            if !obj.contains_key("database_path") {
                obj.insert(
                    "database_path".to_string(),
                    serde_json::Value::Null,
                );
            }

            // Handle embedding_config
            Self::merge_embedding_config(obj, &default_config.embedding_config);

            // Handle chunking_config
            Self::merge_chunking_config(obj, &default_config.chunking_config);
        }
    }

    /// Merge missing fields in embedding_config
    fn merge_embedding_config(obj: &mut serde_json::Map<String, serde_json::Value>, default_embedding: &EmbeddingConfig) {
        if !obj.contains_key("embedding_config") {
            // If embedding_config is completely missing, add the default
            obj.insert(
                "embedding_config".to_string(),
                serde_json::to_value(default_embedding).unwrap(),
            );
        } else if let Some(embedding_obj) = obj.get_mut("embedding_config") {
            // If embedding_config exists but has missing fields, fill them in
            if let Some(embedding_map) = embedding_obj.as_object_mut() {
                if !embedding_map.contains_key("base_url") {
                    embedding_map.insert(
                        "base_url".to_string(),
                        serde_json::Value::String(default_embedding.base_url.clone()),
                    );
                }
                
                if !embedding_map.contains_key("api_key") {
                    embedding_map.insert(
                        "api_key".to_string(),
                        serde_json::Value::Null,
                    );
                }
                
                if !embedding_map.contains_key("model") {
                    embedding_map.insert(
                        "model".to_string(),
                        serde_json::Value::String(default_embedding.model.clone()),
                    );
                }
                
                if !embedding_map.contains_key("dimensions") {
                    embedding_map.insert(
                        "dimensions".to_string(),
                        serde_json::Value::Number(default_embedding.dimensions.into()),
                    );
                }
                
                if !embedding_map.contains_key("batch_size") {
                    embedding_map.insert(
                        "batch_size".to_string(),
                        serde_json::Value::Number(default_embedding.batch_size.into()),
                    );
                }
            }
        }
    }

    /// Merge missing fields in chunking_config
    fn merge_chunking_config(obj: &mut serde_json::Map<String, serde_json::Value>, default_chunking: &ChunkingConfig) {
        if !obj.contains_key("chunking_config") {
            // If chunking_config is completely missing, add the default
            obj.insert(
                "chunking_config".to_string(),
                serde_json::to_value(default_chunking).unwrap(),
            );
        } else if let Some(chunking_obj) = obj.get_mut("chunking_config") {
            // If chunking_config exists but has missing fields, fill them in
            if let Some(chunking_map) = chunking_obj.as_object_mut() {
                if !chunking_map.contains_key("chunk_size") {
                    chunking_map.insert(
                        "chunk_size".to_string(),
                        serde_json::Value::Number(default_chunking.chunk_size.into()),
                    );
                }
                
                if !chunking_map.contains_key("overlap") {
                    chunking_map.insert(
                        "overlap".to_string(),
                        serde_json::Value::Number(default_chunking.overlap.into()),
                    );
                }
            }
        }
    }

    /// Create configuration for local embeddings.
    pub fn with_local_embeddings(
        database_path: Option<PathBuf>,
        base_url: &str,
        model: &str,
        dimensions: usize,
    ) -> Self {
        let embedding_config = EmbeddingConfig {
            base_url: base_url.to_string(),
            api_key: None,
            model: model.to_string(),
            dimensions,
            batch_size: 100,
        };

        Self {
            database_path,
            embedding_config,
            chunking_config: ChunkingConfig::default(),
        }
    }

    /// Create configuration for OpenAI embeddings.
    pub fn with_openai_embeddings(
        database_path: Option<PathBuf>,
        api_key: String,
        model: Option<&str>,
    ) -> Self {
        let embedding_config = EmbeddingConfig {
            base_url: "https://api.openai.com".to_string(),
            api_key: Some(api_key),
            model: model.unwrap_or("text-embedding-ada-002").to_string(),
            dimensions: 1536,
            batch_size: 100,
        };

        Self {
            database_path,
            embedding_config,
            chunking_config: ChunkingConfig::default(),
        }
    }

    /// Create configuration for custom API embeddings.
    pub fn with_custom_embeddings(
        database_path: Option<PathBuf>,
        base_url: &str,
        api_key: Option<String>,
        model: &str,
        dimensions: usize,
    ) -> Self {
        let embedding_config = EmbeddingConfig {
            base_url: base_url.to_string(),
            api_key,
            model: model.to_string(),
            dimensions,
            batch_size: 100,
        };

        Self {
            database_path,
            embedding_config,
            chunking_config: ChunkingConfig::default(),
        }
    }

    /// Update the database path.
    pub fn with_database_path(mut self, path: PathBuf) -> Self {
        self.database_path = Some(path);
        self
    }

    /// Update the chunking configuration.
    pub fn with_chunking_config(mut self, config: ChunkingConfig) -> Self {
        self.chunking_config = config;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RAGConfig::default();
        assert_eq!(config.embedding_config.dimensions, 1536);
        assert_eq!(config.chunking_config.chunk_size, 1000);
        assert_eq!(config.chunking_config.overlap, 100);
    }

    #[test]
    fn test_local_embeddings_config() {
        let config = RAGConfig::with_local_embeddings(
            None,
            "http://localhost:8080",
            "sentence-transformers/all-MiniLM-L6-v2",
            384,
        );
        assert_eq!(config.embedding_config.base_url, "http://localhost:8080");
        assert_eq!(config.embedding_config.model, "sentence-transformers/all-MiniLM-L6-v2");
        assert_eq!(config.embedding_config.dimensions, 384);
        assert!(config.embedding_config.api_key.is_none());
    }

    #[test]
    fn test_openai_config() {
        let config = RAGConfig::with_openai_embeddings(
            None,
            "sk-test-key".to_string(),
            Some("text-embedding-ada-002"),
        );
        assert_eq!(config.embedding_config.base_url, "https://api.openai.com");
        assert_eq!(config.embedding_config.model, "text-embedding-ada-002");
        assert_eq!(config.embedding_config.api_key, Some("sk-test-key".to_string()));
    }

    #[test]
    fn test_chunking_config() {
        let chunking = ChunkingConfig {
            chunk_size: 500,
            overlap: 50,
        };
        
        let config = RAGConfig::default().with_chunking_config(chunking.clone());
        assert_eq!(config.chunking_config.chunk_size, 500);
        assert_eq!(config.chunking_config.overlap, 50);
    }
}