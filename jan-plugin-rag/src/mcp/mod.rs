// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Model Context Protocol (MCP) integration for the RAG plugin.
//! 
//! This module provides MCP tools that allow external clients to interact
//! with the RAG system through the Model Context Protocol.

mod module;

pub use module::RAGMCPModule;

/// Result type for MCP operations
pub type MCPResult<T> = anyhow::Result<T>;