use tauri::{State, AppHandle, Runtime};
use crate::core::state::AppState;
use serde_json::Value;
use std::collections::HashMap;
use super::system::{get_rag_system_with_app, initialize_rag_system_with_app};

#[tauri::command]
pub async fn initialize_rag_system_cmd<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    match initialize_rag_system_with_app(app_handle).await {
        Ok(_) => Ok("RAG system initialized successfully".to_string()),
        Err(e) => Err(format!("Failed to initialize RAG system: {}", e)),
    }
}

#[tauri::command]
pub async fn rag_add_data_source<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
    source_type: String,
    path_or_url: String,
    content: String,
    metadata: Option<Value>,
) -> Result<String, String> {
    let rag_system_state = get_rag_system_with_app(app_handle).await;
    let rag_system_guard = rag_system_state.lock().await;
    
    let metadata_map = metadata.and_then(|v| {
        if let Some(obj) = v.as_object() {
            Some(obj.iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<HashMap<String, Value>>())
        } else {
            None
        }
    });

    match rag_system_guard.add_data_source(&source_type, &path_or_url, &content, metadata_map).await {
        Ok(source_id) => {
            let result = serde_json::json!({
                "status": "success",
                "source_id": source_id,
                "message": "Data source added and processed successfully.",
                "chunk_count": 0
            });
            Ok(result.to_string())
        }
        Err(e) => Err(format!("Failed to add data source: {}", e))
    }
}

#[tauri::command]
pub async fn rag_list_data_sources<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    let rag_system_state = get_rag_system_with_app(app_handle).await;
    let rag_system_guard = rag_system_state.lock().await;
    
    match rag_system_guard.list_data_sources().await {
        Ok(sources) => {
            let result = serde_json::json!({
                "sources": sources
            });
            Ok(result.to_string())
        }
        Err(e) => Err(format!("Failed to list data sources: {}", e))
    }
}

#[tauri::command]
pub async fn get_rag_status<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    let rag_system_state = get_rag_system_with_app(app_handle).await;
    let rag_system_guard = rag_system_state.lock().await;
    
    match rag_system_guard.get_status().await {
        Ok(status) => Ok(status),
        Err(e) => Err(format!("Failed to get RAG status: {}", e))
    }
}

#[tauri::command]
pub async fn rag_remove_data_source<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
    source_id: String,
) -> Result<String, String> {
    let rag_system_state = get_rag_system_with_app(app_handle).await;
    let rag_system_guard = rag_system_state.lock().await;
    
    match rag_system_guard.remove_data_source(&source_id).await {
        Ok(removed) => {
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
        Err(e) => Err(format!("Failed to remove data source: {}", e))
    }
}

#[tauri::command]
pub async fn rag_query_documents<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
    query: String,
    top_k: Option<usize>,
    filters: Option<Value>,
) -> Result<String, String> {
    let rag_system_state = get_rag_system_with_app(app_handle).await;
    let rag_system_guard = rag_system_state.lock().await;
    
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

    match rag_system_guard.query_documents(&query, k, filter_map).await {
        Ok(results) => {
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
        Err(e) => Err(format!("Failed to query documents: {}", e))
    }
}

#[tauri::command]
pub async fn rag_clean_all_data_sources<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    let rag_system_state = get_rag_system_with_app(app_handle).await;
    let rag_system_guard = rag_system_state.lock().await;
    
    match rag_system_guard.clean_all_data_sources().await {
        Ok(_) => {
            let result = serde_json::json!({
                "status": "success",
                "message": "All data sources cleaned successfully",
                "sources_removed": 0,
                "chunks_removed": 0,
                "timestamp": chrono::Utc::now().to_rfc3339()
            });
            Ok(result.to_string())
        }
        Err(e) => Err(format!("Failed to clean data sources: {}", e))
    }
}

#[tauri::command]
pub async fn rag_reset_database<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    let rag_system_state = get_rag_system_with_app(app_handle).await;
    let rag_system_guard = rag_system_state.lock().await;
    
    match rag_system_guard.reset_database().await {
        Ok(_) => Ok("RAG database reset successfully".to_string()),
        Err(e) => Err(format!("Failed to reset RAG database: {}", e))
    }
}