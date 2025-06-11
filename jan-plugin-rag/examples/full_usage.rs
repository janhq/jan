// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Full usage example of the RAG plugin with MCP integration.

use jan_plugin_rag::{RAGConfig, EmbeddingConfig, ChunkingConfig};

fn main() {
    println!("RAG plugin full usage example with MCP integration:");

    // Configure RAG system with local embeddings
    let rag_config = RAGConfig {
        embedding_config: EmbeddingConfig {
            base_url: "http://localhost:11434".to_string(),
            api_key: None,
            model: "nomic-embed-text".to_string(),
            dimensions: 768,
            batch_size: 100,
        },
        chunking_config: ChunkingConfig {
            chunk_size: 1000,
            overlap: 100,
        },
        database_path: None, // Will use app data directory
    };

    println!("Configuration created:");
    println!("- Embedding model: {}", rag_config.embedding_config.model);
    println!("- Base URL: {}", rag_config.embedding_config.base_url);
    println!("- Dimensions: {}", rag_config.embedding_config.dimensions);
    println!("- Batch size: {}", rag_config.embedding_config.batch_size);
    println!("- Chunk size: {}", rag_config.chunking_config.chunk_size);
    println!("- Chunk overlap: {}", rag_config.chunking_config.overlap);

    println!("\nTo use this configuration in a Tauri app:");
    println!("```rust");
    println!("tauri::Builder::default()");
    println!("    .plugin(jan_plugin_rag::init_with_config_and_mcp(rag_config))");
    println!("    .setup(|app| {{");
    println!("        // Access MCP module if needed");
    println!("        if let Some(mcp_module) = app.try_state::<RAGMCPModule<tauri::Wry>>() {{");
    println!("            // Use MCP tools for enhanced functionality");
    println!("        }}");
    println!("        Ok(())");
    println!("    }})");
    println!("    .run(tauri::generate_context!())");
    println!("```");

    println!("\nAvailable commands:");
    println!("- plugin:rag|initialize_rag");
    println!("- plugin:rag|add_data_source");
    println!("- plugin:rag|list_data_sources");
    println!("- plugin:rag|remove_data_source");
    println!("- plugin:rag|query_documents");
    println!("- plugin:rag|clean_all_data_sources");
    println!("- plugin:rag|reset_database");
    println!("- plugin:rag|get_rag_status");
    println!("- plugin:rag|get_embedding_config");
    println!("- plugin:rag|update_embedding_config");
    println!("- plugin:rag|get_chunking_config");
    println!("- plugin:rag|update_chunking_config");
    println!("- plugin:rag|save_config_to_file");

    println!("\nMCP Integration Features:");
    println!("- Built-in MCP tools for document processing");
    println!("- Automatic tool registration");
    println!("- Enhanced query capabilities");
    println!("- Integration with external MCP servers");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_full_config() {
        let config = RAGConfig {
            embedding_config: EmbeddingConfig {
                base_url: "http://localhost:11434".to_string(),
                api_key: None,
                model: "nomic-embed-text".to_string(),
                dimensions: 768,
                batch_size: 100,
            },
            chunking_config: ChunkingConfig {
                chunk_size: 1000,
                overlap: 100,
            },
            database_path: None,
        };

        assert_eq!(config.embedding_config.base_url, "http://localhost:11434");
        assert_eq!(config.embedding_config.model, "nomic-embed-text");
        assert_eq!(config.embedding_config.dimensions, 768);
        assert_eq!(config.chunking_config.chunk_size, 1000);
        assert!(config.embedding_config.api_key.is_none());
    }
}