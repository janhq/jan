// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! RAG MCP module implementation for the plugin.

use anyhow::Result;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::borrow::Cow;
use tauri::{AppHandle, Runtime, Manager};

use rmcp::model::{Tool, Content};

use crate::core::RAGSystem;

type JsonObject = serde_json::Map<String, Value>;

/// RAG MCP Module for plugin integration
pub struct RAGMCPModule<R: Runtime> {
    app_handle: Option<AppHandle<R>>,
}

impl<R: Runtime> RAGMCPModule<R> {
    pub fn new() -> Self {
        Self {
            app_handle: None,
        }
    }

    pub fn with_app_handle(app_handle: AppHandle<R>) -> Self {
        Self {
            app_handle: Some(app_handle),
        }
    }

    /// Get the RAG system from the plugin state
    fn get_rag_system(&self) -> Option<RAGSystem> {
        self.app_handle
            .as_ref()
            .and_then(|handle| handle.try_state::<RAGSystem>())
            .map(|state| state.inner().clone())
    }

    /// Create a consistent error response
    fn create_error_response(error: &str) -> Vec<Content> {
        let result = json!({
            "status": "error",
            "error": error
        });
        vec![Content::text(result.to_string())]
    }

    /// Create a consistent success response
    fn create_success_response(data: Value) -> Vec<Content> {
        let mut result = json!({
            "status": "success"
        });
        
        if let Value::Object(obj) = data {
            for (key, value) in obj {
                result[key] = value;
            }
        }
        
        vec![Content::text(result.to_string())]
    }

    /// Parse metadata from JSON value
    fn parse_metadata(metadata_value: Option<&Value>) -> Option<HashMap<String, Value>> {
        metadata_value.and_then(|v| {
            if let Some(obj) = v.as_object() {
                Some(obj.iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect::<HashMap<String, Value>>())
            } else {
                None
            }
        })
    }

    /// Parse filters from JSON value
    fn parse_filters(filters_value: Option<&Value>) -> Option<HashMap<String, String>> {
        filters_value.and_then(|v| {
            if let Some(obj) = v.as_object() {
                Some(obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect::<HashMap<String, String>>())
            } else {
                None
            }
        })
    }

    /// Get all tools provided by this MCP module
    pub fn get_tools(&self) -> Result<Vec<Tool>> {
        // Helper function to create input schema
        fn create_schema(value: Value) -> Arc<JsonObject> {
            match value {
                Value::Object(map) => Arc::new(map),
                _ => Arc::new(JsonObject::new()),
            }
        }
        
        Ok(vec![
            Tool {
                name: Cow::Borrowed("rag_initialize"),
                description: Some(Cow::Borrowed("Initialize the RAG system with LanceDB for vector storage and document indexing")),
                input_schema: create_schema(json!({
                    "type": "object",
                    "properties": {}
                })),
                annotations: None,
            },
            Tool {
                name: Cow::Borrowed("rag_add_data_source"),
                description: Some(Cow::Borrowed("Adds a new data source (e.g., file, URL) to the RAG system for processing and indexing.")),
                input_schema: create_schema(json!({
                    "type": "object",
                    "properties": {
                        "source_type": {
                            "type": "string",
                            "enum": ["file", "url", "text"],
                            "description": "Type of the data source."
                        },
                        "path_or_url": {
                            "type": "string",
                            "description": "Absolute path to the local file or the URL of the data source."
                        },
                        "content": {
                            "type": "string",
                            "description": "For text source_type, the actual text content to index."
                        },
                        "metadata": {
                            "type": "object",
                            "description": "Optional metadata to associate with the source."
                        }
                    },
                    "required": ["source_type"]
                })),
                annotations: None,
            },
            Tool {
                name: Cow::Borrowed("rag_list_data_sources"),
                description: Some(Cow::Borrowed("Lists all available data sources currently managed by the RAG system.")),
                input_schema: create_schema(json!({
                    "type": "object",
                    "properties": {}
                })),
                annotations: None,
            },
            Tool {
                name: Cow::Borrowed("rag_remove_data_source"),
                description: Some(Cow::Borrowed("Removes a data source and all its associated indexed data from the RAG system.")),
                input_schema: create_schema(json!({
                    "type": "object",
                    "properties": {
                        "source_id": {
                            "type": "string",
                            "description": "The unique identifier of the data source to remove."
                        }
                    },
                    "required": ["source_id"]
                })),
                annotations: None,
            },
            Tool {
                name: Cow::Borrowed("rag_query_documents"),
                description: Some(Cow::Borrowed("Queries the RAG system with a given text to retrieve relevant document chunks/contexts.")),
                input_schema: create_schema(json!({
                    "type": "object",
                    "properties": {
                        "query_text": {
                            "type": "string",
                            "description": "The query text to search for."
                        },
                        "top_k": {
                            "type": "integer",
                            "minimum": 1,
                            "default": 3,
                            "description": "Number of top relevant chunks to retrieve."
                        },
                        "filters": {
                            "type": "object",
                            "properties": {
                                "source_id": {
                                    "type": "string",
                                    "description": "Filter results by a specific source ID."
                                }
                            },
                            "description": "Optional filters to apply to the search."
                        }
                    },
                    "required": ["query_text"]
                })),
                annotations: None,
            },
            Tool {
                name: Cow::Borrowed("rag_clean_all_data_sources"),
                description: Some(Cow::Borrowed("Removes all data sources and their associated indexed data from the RAG system by re-initializing the database.")),
                input_schema: create_schema(json!({
                    "type": "object",
                    "properties": {}
                })),
                annotations: None,
            },
            Tool {
                name: Cow::Borrowed("rag_get_status"),
                description: Some(Cow::Borrowed("Get the current status of the RAG system including database connection and statistics.")),
                input_schema: create_schema(json!({
                    "type": "object",
                    "properties": {}
                })),
                annotations: None,
            },
        ])
    }

    /// Execute a tool call
    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Vec<Content>> {
        let rag_system = match self.get_rag_system() {
            Some(system) => system,
            None => {
                return Ok(Self::create_error_response("RAG system not initialized"));
            }
        };
        
        let args = arguments.as_object().unwrap_or(&serde_json::Map::new()).clone();

        match name {
            "rag_initialize" => {
                // Initialize the database if not already initialized
                match rag_system.initialize_database(None).await {
                    Ok(_) => {
                        match rag_system.get_status().await {
                            Ok(status) => {
                                Ok(Self::create_success_response(json!({
                                    "message": "RAG system initialized and ready",
                                    "status": status
                                })))
                            }
                            Err(e) => {
                                Ok(Self::create_error_response(&format!("RAG system initialized but status check failed: {}", e)))
                            }
                        }
                    }
                    Err(e) => {
                        Ok(Self::create_error_response(&format!("Failed to initialize RAG system: {}", e)))
                    }
                }
            }
            "rag_add_data_source" => {
                let source_type = args.get("source_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("text");
                let path_or_url = args.get("path_or_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let content = args.get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let metadata = Self::parse_metadata(args.get("metadata"));

                match rag_system.add_data_source(source_type, path_or_url, content, metadata).await {
                    Ok(source_id) => {
                        Ok(Self::create_success_response(json!({
                            "source_id": source_id,
                            "message": "Data source added and processed successfully",
                            "chunk_count": 0
                        })))
                    }
                    Err(e) => {
                        Ok(Self::create_error_response(&format!("Failed to add data source: {}", e)))
                    }
                }
            }
            "rag_list_data_sources" => {
                match rag_system.list_data_sources().await {
                    Ok(sources) => {
                        Ok(Self::create_success_response(json!({
                            "sources": sources
                        })))
                    }
                    Err(e) => {
                        Ok(Self::create_error_response(&format!("Failed to list data sources: {}", e)))
                    }
                }
            }
            "rag_remove_data_source" => {
                let source_id = args.get("source_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if source_id.is_empty() {
                    return Ok(Self::create_error_response("source_id is required"));
                }

                match rag_system.remove_data_source(source_id).await {
                    Ok(removed) => {
                        Ok(Self::create_success_response(json!({
                            "removed": removed,
                            "message": if removed { 
                                format!("Data source {} removed successfully", source_id) 
                            } else { 
                                format!("Data source {} not found", source_id) 
                            }
                        })))
                    }
                    Err(e) => {
                        Ok(Self::create_error_response(&format!("Failed to remove data source: {}", e)))
                    }
                }
            }
            "rag_query_documents" => {
                let query_text = args.get("query_text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let top_k = args.get("top_k")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3) as usize;
                let filters = Self::parse_filters(args.get("filters"));

                if query_text.is_empty() {
                    return Ok(Self::create_error_response("query_text is required"));
                }

                match rag_system.query_documents(query_text, top_k, filters).await {
                    Ok(results) => {
                        Ok(Self::create_success_response(json!({
                            "query": query_text,
                            "total_results": results.len(),
                            "retrieved_contexts": results.iter().map(|r| json!({
                                "document_id": r.source_id,
                                "text_chunk": r.content,
                                "similarity_score": r.score,
                                "distance": 1.0 / (1.0 + r.score) - 1.0, // Convert similarity back to distance
                                "chunk_id": r.chunk_id,
                                "metadata": r.metadata
                            })).collect::<Vec<_>>(),
                            "source_info": json!({}),
                            "query_timestamp": chrono::Utc::now().to_rfc3339()
                        })))
                    }
                    Err(e) => {
                        Ok(Self::create_error_response(&format!("Failed to query documents: {}", e)))
                    }
                }
            }
            "rag_clean_all_data_sources" => {
                match rag_system.clean_all_data_sources().await {
                    Ok(_) => {
                        Ok(Self::create_success_response(json!({
                            "message": "All data sources cleaned successfully",
                            "sources_removed": 0,
                            "chunks_removed": 0,
                            "timestamp": chrono::Utc::now().to_rfc3339()
                        })))
                    }
                    Err(e) => {
                        Ok(Self::create_error_response(&format!("Failed to clean data sources: {}", e)))
                    }
                }
            }
            "rag_get_status" => {
                match rag_system.get_status().await {
                    Ok(status) => {
                        Ok(Self::create_success_response(json!({
                            "rag_status": status
                        })))
                    }
                    Err(e) => {
                        Ok(Self::create_error_response(&format!("Failed to get RAG status: {}", e)))
                    }
                }
            }
            _ => {
                Ok(Self::create_error_response(&format!("Unknown tool: {}", name)))
            }
        }
    }

    /// Get the module name
    pub fn module_name(&self) -> &'static str {
        "rag"
    }
}

impl<R: Runtime> Default for RAGMCPModule<R> {
    fn default() -> Self {
        Self::new()
    }
}