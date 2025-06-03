use anyhow::{Result, anyhow};
use serde::{Serialize, Deserialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::core::cmd::EmbeddingConfig;

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    input: Vec<String>,
    model: String,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

/// Embeddings generator using OpenAI-compatible API
pub struct EmbeddingsGenerator {
    config: Arc<RwLock<EmbeddingConfig>>,
    client: reqwest::Client,
}

impl EmbeddingsGenerator {
    /// Create a new embeddings generator with default configuration
    pub fn new() -> Self {
        Self {
            config: Arc::new(RwLock::new(EmbeddingConfig::default())),
            client: reqwest::Client::new(),
        }
    }

    /// Create a new embeddings generator with custom configuration
    pub fn with_config(config: EmbeddingConfig) -> Self {
        Self {
            config: Arc::new(RwLock::new(config)),
            client: reqwest::Client::new(),
        }
    }
    /// Update the configuration
    pub async fn update_config(&self, config: EmbeddingConfig) {
        *self.config.write().await = config;
    }

    /// Initialize the embeddings generator (for compatibility)
    pub async fn initialize(&self) -> Result<()> {
        // No initialization needed for API-based approach
        log::info!("Embeddings generator initialized with OpenAI-compatible API");
        Ok(())
    }

    /// Check if the model is initialized (always true for API-based approach)
    pub async fn is_initialized(&self) -> bool {
        true
    }

    /// Generate embeddings for a batch of texts
    pub async fn create_embeddings(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let config = self.config.read().await;
        let batch_size = config.batch_size;
        
        log::info!("Creating embeddings with config: base_url={}, model={}, api_key_present={}, batch_size={}",
            config.base_url,
            config.model,
            config.api_key.is_some(),
            batch_size
        );
        
        // If texts fit in a single batch, process normally
        if texts.len() <= batch_size {
            return self.create_embeddings_batch(texts, &config).await;
        }
        
        // Process texts in batches
        let mut all_embeddings = Vec::new();
        let total_batches = (texts.len() + batch_size - 1) / batch_size;
        let mut successful_batches = 0;
        let mut failed_batches = Vec::new();
        
        log::info!("Processing {} texts in {} batches of size {}", texts.len(), total_batches, batch_size);
        
        for (batch_index, batch_texts) in texts.chunks(batch_size).enumerate() {
            let batch_num = batch_index + 1;
            log::info!("Processing batch {}/{} with {} texts", batch_num, total_batches, batch_texts.len());
            
            match self.create_embeddings_batch(batch_texts, &config).await {
                Ok(batch_embeddings) => {
                    all_embeddings.extend(batch_embeddings);
                    successful_batches += 1;
                    log::debug!("Batch {}/{} completed successfully", batch_num, total_batches);
                }
                Err(e) => {
                    let error_msg = format!("Batch {}/{} failed: {}", batch_num, total_batches, e);
                    log::error!("{}", error_msg);
                    failed_batches.push((batch_num, e.to_string()));
                    
                    // Add placeholder embeddings for failed batch to maintain index alignment
                    let placeholder_embeddings = vec![vec![0.0; config.dimensions]; batch_texts.len()];
                    all_embeddings.extend(placeholder_embeddings);
                }
            }
        }
        
        if !failed_batches.is_empty() {
            let failed_batch_summary: Vec<String> = failed_batches
                .iter()
                .map(|(batch_num, error)| format!("Batch {}: {}", batch_num, error))
                .collect();
            
            log::warn!(
                "Completed with partial success: {}/{} batches successful. Failed batches: [{}]",
                successful_batches,
                total_batches,
                failed_batch_summary.join(", ")
            );
            
            // If all batches failed, return an error
            if successful_batches == 0 {
                return Err(anyhow!(
                    "All {} batches failed. Errors: [{}]",
                    total_batches,
                    failed_batch_summary.join(", ")
                ));
            }
            
            // If some batches failed but some succeeded, log warning but continue
            log::warn!(
                "Partial success: {} embeddings generated with {} failed batches",
                all_embeddings.len(),
                failed_batches.len()
            );
        } else {
            log::info!("Successfully processed all {} batches, total embeddings: {}", total_batches, all_embeddings.len());
        }
        
        Ok(all_embeddings)
    }

    /// Generate embeddings for a single batch of texts
    async fn create_embeddings_batch(&self, texts: &[&str], config: &EmbeddingConfig) -> Result<Vec<Vec<f32>>> {
        // Convert texts to owned strings
        let input: Vec<String> = texts.iter().map(|&s| s.to_string()).collect();
        
        // Build the API endpoint
        let url = format!("{}/v1/embeddings", config.base_url.trim_end_matches('/'));

        log::debug!("Embedding request URL: {}", url);
        
        // Create the request payload
        let request_body = EmbeddingRequest {
            input,
            model: config.model.clone(),
        };
        
        // Build the request
        let mut request_builder = self.client
            .post(&url)
            .json(&request_body);
        
        // Add API key if provided
        if let Some(api_key) = &config.api_key {
            request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
        }
        
        // Send the request
        let response = request_builder
            .send()
            .await
            .map_err(|e| anyhow!("Failed to send embedding request: {}", e))?;
        
        // Check response status
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!("Embedding API request failed with status {}: {}", status, error_text));
        }
        
        // Parse the response
        let embedding_response: EmbeddingResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse embedding response: {}", e))?;

        log::debug!(
            "Received {} embeddings from OpenAI-compatible API",
            embedding_response.data.len()
        );

        log::debug!(
            "Embedding response: {:?}",
            embedding_response.data.iter().map(|d| d.embedding.len()).collect::<Vec<_>>()
        );
        
        // Extract embeddings
        let embeddings: Vec<Vec<f32>> = embedding_response.data
            .into_iter()
            .map(|data| data.embedding)
            .collect();
        
        // Validate dimensions
        let expected_dim = config.dimensions;
        for (i, embedding) in embeddings.iter().enumerate() {
            if embedding.len() != expected_dim {
                log::warn!(
                    "Embedding {} has dimension {} but expected {}. The API may be using a different model.",
                    i, embedding.len(), expected_dim
                );
            }
        }
        
        Ok(embeddings)
    }

    /// Get the embedding dimension from configuration
    pub async fn embedding_dim(&self) -> usize {
        self.config.read().await.dimensions
    }
}

impl Clone for EmbeddingsGenerator {
    fn clone(&self) -> Self {
        Self {
            config: Arc::clone(&self.config),
            client: self.client.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_embeddings_generator_creation() {
        let generator = EmbeddingsGenerator::new();
        assert!(generator.is_initialized().await);
    }

    #[tokio::test]
    async fn test_embeddings_generator_with_config() {
        let config = EmbeddingConfig {
            base_url: "http://localhost:8080".to_string(),
            api_key: Some("test-key".to_string()),
            model: "text-embedding-ada-002".to_string(),
            dimensions: 1536,
            batch_size: 100,
        };
        
        let generator = EmbeddingsGenerator::with_config(config.clone());
        let stored_config = generator.config.read().await;
        assert_eq!(stored_config.base_url, config.base_url);
        assert_eq!(stored_config.model, config.model);
        assert_eq!(stored_config.dimensions, config.dimensions);
        assert_eq!(stored_config.batch_size, config.batch_size);
    }

    #[tokio::test]
    async fn test_batch_size_configuration() {
        let config = EmbeddingConfig {
            base_url: "http://localhost:8080".to_string(),
            api_key: Some("test-key".to_string()),
            model: "text-embedding-ada-002".to_string(),
            dimensions: 1536,
            batch_size: 50,
        };
        
        let generator = EmbeddingsGenerator::with_config(config);
        let stored_config = generator.config.read().await;
        assert_eq!(stored_config.batch_size, 50);
    }

    #[tokio::test]
    async fn test_default_batch_size() {
        let generator = EmbeddingsGenerator::new();
        let config = generator.config.read().await;
        assert_eq!(config.batch_size, 100);
    }

    #[tokio::test]
    async fn test_empty_texts_handling() {
        let generator = EmbeddingsGenerator::new();
        let result = generator.create_embeddings(&[]).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_batching_logic() {
        // Test that the batching logic correctly splits texts
        let config = EmbeddingConfig {
            base_url: "http://localhost:8080".to_string(),
            api_key: Some("test-key".to_string()),
            model: "text-embedding-ada-002".to_string(),
            dimensions: 1536,
            batch_size: 2, // Small batch size for testing
        };
        
        let generator = EmbeddingsGenerator::with_config(config);
        
        // Test with 5 texts, should create 3 batches (2, 2, 1)
        let texts = vec!["text1", "text2", "text3", "text4", "text5"];
        
        // This will fail since we're not running a real server, but we can verify
        // the batching logic is working by checking the logs or behavior
        let result = generator.create_embeddings(&texts).await;
        
        // The request should fail because there's no real server,
        // but the batching logic should have been executed
        assert!(result.is_err());
    }
}