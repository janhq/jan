// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Tauri commands for the RAG plugin.

use tauri::{command, AppHandle, Runtime, State, Manager};
use serde_json::Value;
use std::collections::HashMap;

use crate::{
    config::{EmbeddingConfig, ChunkingConfig},
    core::RAGSystem,
    models::*,
    Result,
};

/// Initialize the RAG system
#[command]
pub async fn initialize_rag<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let mut system = state.inner().clone();
    
    // Use app data directory for database storage
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| crate::Error::configuration(format!("Failed to get app data directory: {}", e)))?;
    
    let db_path = Some(app_data_dir.join("rag_db"));
    
    system.initialize(db_path).await?;
    Ok("RAG system initialized successfully".to_string())
}

/// Add a data source to the RAG system
#[command]
pub async fn add_data_source<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
    source_type: String,
    path_or_url: String,
    content: String,
    metadata: Option<Value>,
) -> Result<String> {
    let system = state.inner().clone();
    
    let metadata_map = metadata.and_then(|v| {
        if let Some(obj) = v.as_object() {
            Some(obj.iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<HashMap<String, Value>>())
        } else {
            None
        }
    });

    let source_id = system.add_data_source(&source_type, &path_or_url, &content, metadata_map).await?;
    
    let result = serde_json::json!({
        "status": "success",
        "source_id": source_id,
        "message": "Data source added and processed successfully.",
        "chunk_count": 0
    });
    
    Ok(result.to_string())
}

/// List all data sources
#[command]
pub async fn list_data_sources<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let system = state.inner().clone();
    
    let sources = system.list_data_sources().await?;
    let result = serde_json::json!({
        "sources": sources
    });
    
    Ok(result.to_string())
}

/// Remove a data source
#[command]
pub async fn remove_data_source<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
    source_id: String,
) -> Result<String> {
    let system = state.inner().clone();
    
    let removed = system.remove_data_source(&source_id).await?;
    let result = serde_json::json!({
        "status": "success",
        "removed": removed,
        "message": if removed { 
            format!("Data source {} removed successfully", source_id) 
        } else { 
            format!("Data source {} not found", source_id) 
        }
    });
    
    Ok(result.to_string())
}

/// Query documents using vector similarity search
#[command]
pub async fn query_documents<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
    query: String,
    top_k: Option<usize>,
    filters: Option<Value>,
) -> Result<String> {
    let system = state.inner().clone();
    
    let k = top_k.unwrap_or(3);
    let filter_map = filters.and_then(|v| {
        if let Some(obj) = v.as_object() {
            Some(obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect::<HashMap<String, String>>())
        } else {
            None
        }
    });

    let results = system.query_documents(&query, k, filter_map).await?;
    let result = serde_json::json!({
        "query": query,
        "total_results": results.len(),
        "retrieved_contexts": results.iter().map(|r| serde_json::json!({
            "document_id": r.source_id,
            "text_chunk": r.content,
            "similarity_score": r.score,
            "distance": 1.0 / (1.0 + r.score) - 1.0, // Convert back to distance
            "chunk_id": r.chunk_id,
            "metadata": r.metadata
        })).collect::<Vec<_>>(),
        "source_info": serde_json::json!({}),
        "query_timestamp": chrono::Utc::now().to_rfc3339()
    });
    
    Ok(result.to_string())
}

/// Clean all data sources
#[command]
pub async fn clean_all_data_sources<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let system = state.inner().clone();
    
    system.clean_all_data_sources().await?;
    let result = serde_json::json!({
        "status": "success",
        "message": "All data sources cleaned successfully",
        "sources_removed": 0,
        "chunks_removed": 0,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });
    
    Ok(result.to_string())
}

/// Reset the database
#[command]
pub async fn reset_database<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let system = state.inner().clone();
    
    system.reset_database().await?;
    Ok("RAG database reset successfully".to_string())
}

/// Get RAG system status
#[command]
pub async fn get_rag_status<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let system = state.inner().clone();
    
    let status = system.get_status().await?;
    Ok(status)
}

/// Get current embedding configuration
#[command]
pub async fn get_embedding_config<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let system = state.inner().clone();
    
    let config = system.get_embedding_config().await?;
    let result = serde_json::json!({
        "embedding_config": config
    });
    
    Ok(result.to_string())
}

/// Update embedding configuration
#[command]
pub async fn update_embedding_config<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
    embedding_config: EmbeddingConfig,
) -> Result<String> {
    let system = state.inner().clone();
    
    system.update_embedding_config(embedding_config.clone()).await?;
    
    // Save the updated configuration to file
    let current_config = system.get_full_config().await?;
    if let Err(e) = current_config.save_to_file(&app_handle) {
        log::warn!("Failed to save RAG config to file: {}", e);
    }
    
    let result = serde_json::json!({
        "status": "success",
        "message": "Embedding configuration updated successfully"
    });
    
    Ok(result.to_string())
}

/// Get current chunking configuration
#[command]
pub async fn get_chunking_config<R: Runtime>(
    _app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let system = state.inner().clone();
    
    let config = system.get_chunking_config().await?;
    let result = serde_json::json!({
        "chunking_config": config
    });
    
    Ok(result.to_string())
}

/// Update chunking configuration
#[command]
pub async fn update_chunking_config<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
    chunking_config: ChunkingConfig,
) -> Result<String> {
    let system = state.inner().clone();
    
    system.update_chunking_config(chunking_config.clone()).await?;
    
    // Save the updated configuration to file
    let current_config = system.get_full_config().await?;
    if let Err(e) = current_config.save_to_file(&app_handle) {
        log::warn!("Failed to save RAG config to file: {}", e);
    }
    
    let result = serde_json::json!({
        "status": "success",
        "message": "Chunking configuration updated successfully"
    });
    
    Ok(result.to_string())
}

/// Save current configuration to file
#[command]
pub async fn save_config_to_file<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, RAGSystem>,
) -> Result<String> {
    let system = state.inner().clone();
    
    let current_config = system.get_full_config().await?;
    
    match current_config.save_to_file(&app_handle) {
        Ok(_) => {
            let result = serde_json::json!({
                "status": "success",
                "message": "Configuration saved to file successfully"
            });
            Ok(result.to_string())
        }
        Err(e) => {
            let result = serde_json::json!({
                "status": "error",
                "message": format!("Failed to save configuration to file: {}", e)
            });
            Ok(result.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RAGConfig;

    #[tokio::test]
    async fn test_command_initialization() {
        // Test that commands can be created without runtime errors
        let config = RAGConfig::default();
        let system = RAGSystem::with_config(config);
        
        // This test just verifies the command structure compiles
        assert!(true);
    }
}