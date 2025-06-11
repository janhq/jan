// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Basic usage example for the Jan RAG plugin.

use jan_plugin_rag::{RAGConfig, EmbeddingConfig, ChunkingConfig};

fn main() {
    println!("RAG plugin basic usage examples:");

    // Example 1: Default configuration
    println!("1. Default RAG configuration");
    let default_config = RAGConfig::default();
    println!("   - Default embedding dimensions: {}", default_config.embedding_config.dimensions);
    println!("   - Default chunk size: {}", default_config.chunking_config.chunk_size);

    // Example 2: Custom OpenAI configuration
    println!("2. Custom OpenAI configuration");
    let embedding_config = EmbeddingConfig {
        base_url: "https://api.openai.com".to_string(),
        api_key: Some("your-openai-api-key".to_string()),
        model: "text-embedding-ada-002".to_string(),
        dimensions: 1536,
        batch_size: 100,
    };

    let chunking_config = ChunkingConfig {
        chunk_size: 1000,
        overlap: 100,
    };

    let openai_config = RAGConfig {
        database_path: None, // Use default path
        embedding_config,
        chunking_config,
    };

    println!("   - OpenAI config dimensions: {}", openai_config.embedding_config.dimensions);

    // Example 3: Local embeddings configuration
    println!("3. Local embeddings configuration");
    let local_embedding_config = EmbeddingConfig {
        base_url: "http://localhost:8080".to_string(),
        api_key: None,
        model: "sentence-transformers/all-MiniLM-L6-v2".to_string(),
        dimensions: 384,
        batch_size: 50,
    };

    let local_chunking_config = ChunkingConfig {
        chunk_size: 500,
        overlap: 50,
    };

    let local_config = RAGConfig {
        database_path: None,
        embedding_config: local_embedding_config,
        chunking_config: local_chunking_config,
    };

    println!("   - Local config dimensions: {}", local_config.embedding_config.dimensions);

    println!("\nThese configurations can be used with:");
    println!("- jan_plugin_rag::init() for default configuration");
    println!("- jan_plugin_rag::init_with_config(config) for custom configuration");
    println!("- jan_plugin_rag::init_with_config_and_mcp(config) for MCP integration");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_config() {
        let config = RAGConfig::default();
        assert_eq!(config.embedding_config.dimensions, 1536);
        assert_eq!(config.chunking_config.chunk_size, 1000);
    }

    #[test]
    fn test_custom_config() {
        let embedding_config = EmbeddingConfig {
            base_url: "https://api.openai.com".to_string(),
            api_key: Some("test-key".to_string()),
            model: "text-embedding-ada-002".to_string(),
            dimensions: 1536,
            batch_size: 100,
        };

        let chunking_config = ChunkingConfig {
            chunk_size: 1000,
            overlap: 100,
        };

        let config = RAGConfig {
            database_path: None,
            embedding_config,
            chunking_config,
        };

        assert_eq!(config.embedding_config.base_url, "https://api.openai.com");
        assert_eq!(config.embedding_config.api_key, Some("test-key".to_string()));
    }
}