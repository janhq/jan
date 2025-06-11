// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Public MCP API for the RAG plugin

use rmcp::model::{Tool, Content};
use serde_json::Value;
use tauri::{AppHandle, Runtime, Manager};
use anyhow::Result;

use crate::mcp::RAGMCPModule;

/// Get all available RAG MCP tools from the plugin
pub fn get_rag_tools<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Tool>> {
    if let Some(rag_mcp) = app.try_state::<RAGMCPModule<R>>() {
        rag_mcp.get_tools()
    } else {
        // If MCP module is not managed, create a temporary one
        let rag_mcp = RAGMCPModule::with_app_handle(app.clone());
        rag_mcp.get_tools()
    }
}

/// Call a RAG MCP tool from the plugin
pub async fn call_rag_tool<R: Runtime>(app: &AppHandle<R>, tool_name: &str, arguments: Value) -> Result<Vec<Content>> {
    if let Some(rag_mcp) = app.try_state::<RAGMCPModule<R>>() {
        rag_mcp.call_tool(tool_name, arguments).await
    } else {
        // If MCP module is not managed, create a temporary one
        let rag_mcp = RAGMCPModule::with_app_handle(app.clone());
        rag_mcp.call_tool(tool_name, arguments).await
    }
}

/// Check if RAG MCP tools are available
pub fn has_rag_mcp<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<RAGMCPModule<R>>().is_some() || app.try_state::<crate::core::RAGSystem>().is_some()
}