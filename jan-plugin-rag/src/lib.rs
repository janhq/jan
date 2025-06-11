// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! # Jan Plugin RAG
//!
//! A Jan plugin for Retrieval-Augmented Generation (RAG) functionality.
//!
//! This plugin provides vector database operations, document processing,
//! text chunking, embeddings generation, and semantic search capabilities.

use tauri::{
    plugin::{Builder as TauriBuilder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod config;
mod core;
mod error;
mod mcp;
mod mcp_api;
mod models;

pub use config::{RAGConfig, EmbeddingConfig, ChunkingConfig};
pub use error::{Error, Result};
pub use models::*;
pub use mcp::RAGMCPModule;
pub use mcp_api::*;

// Re-export the builder for convenience
pub use PluginBuilder as Builder;

use crate::commands::*;
use crate::core::RAGSystem;

/// Plugin builder for configuring RAG functionality
pub struct PluginBuilder {
    config: Option<RAGConfig>,
    enable_mcp: bool,
}

impl PluginBuilder {
    /// Create a new plugin builder
    pub fn new() -> Self {
        Self {
            config: None,
            enable_mcp: false,
        }
    }

    /// Set custom RAG configuration
    pub fn with_config(mut self, config: RAGConfig) -> Self {
        self.config = Some(config);
        self
    }

    /// Enable MCP (Model Context Protocol) integration
    pub fn enable_mcp(mut self) -> Self {
        self.enable_mcp = true;
        self
    }

    /// Build the Tauri plugin
    pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
        let config_provided = self.config.is_some();
        let config = self.config.unwrap_or_default();
        let enable_mcp = self.enable_mcp;
        
        TauriBuilder::new("rag")
            .invoke_handler(tauri::generate_handler![
                initialize_rag,
                add_data_source,
                list_data_sources,
                remove_data_source,
                query_documents,
                clean_all_data_sources,
                reset_database,
                get_rag_status,
                get_embedding_config,
                update_embedding_config,
                get_chunking_config,
                update_chunking_config,
                save_config_to_file
            ])
            .setup(move |app, _api| {
                println!("RAG plugin setup function starting...");
                log::info!("RAG plugin setup function starting...");
                
                // If config provided, use it; otherwise load from file
                let final_config = if config_provided {
                    println!("Using provided config");
                    log::info!("Using provided config");
                    // Use provided config if available
                    config.clone()
                } else {
                    println!("Loading config from file or using default");
                    log::info!("Loading config from file or using default");
                    // Load from file or create default
                    crate::config::RAGConfig::load_from_file(&app)
                };
                
                println!("RAG plugin initializing with config from: {}, base_url={}, model={}, dimensions={}",
                    if config_provided { "provided config" } else { "file or default" },
                    final_config.embedding_config.base_url,
                    final_config.embedding_config.model,
                    final_config.embedding_config.dimensions
                );
                log::info!("RAG plugin initializing with config from: {}, base_url={}, model={}, dimensions={}",
                    if config_provided { "provided config" } else { "file or default" },
                    final_config.embedding_config.base_url,
                    final_config.embedding_config.model,
                    final_config.embedding_config.dimensions
                );
                
                // Create RAG system with the loaded configuration
                let rag_system = RAGSystem::with_config(final_config);
                
                // Initialize the database automatically during startup
                println!("Initializing RAG database...");
                log::info!("Initializing RAG database...");
                
                // Use tokio runtime to handle async initialization
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => {
                        let rag_system_clone = rag_system.clone();
                        rt.block_on(async move {
                            match rag_system_clone.initialize_database(None).await {
                                Ok(_) => {
                                    println!("RAG database initialized successfully during startup");
                                    log::info!("RAG database initialized successfully during startup");
                                }
                                Err(e) => {
                                    let error_msg = format!("Failed to initialize RAG database during startup: {}", e);
                                    println!("{}", error_msg);
                                    log::error!("{}", error_msg);
                                    // Note: We'll continue even if initialization fails, allowing manual retry
                                }
                            }
                        });
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to create tokio runtime: {}", e);
                        println!("{}", error_msg);
                        log::error!("{}", error_msg);
                        // Continue without async initialization - database can be initialized manually later
                    }
                }
                
                app.manage(rag_system);
                
                println!("RAG system created, initialized, and managed");
                log::info!("RAG system created, initialized, and managed");
                
                // Initialize MCP module if enabled
                if enable_mcp {
                    println!("Initializing MCP module");
                    log::info!("Initializing MCP module");
                    let mcp_module = RAGMCPModule::with_app_handle(app.clone());
                    app.manage(mcp_module);
                    log::info!("RAG plugin MCP integration enabled");
                }
                
                Ok(())
            })
            .build()
    }
}

impl Default for PluginBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize the RAG plugin with default configuration.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new().build()
}

/// Initialize the RAG plugin with custom configuration.
pub fn init_with_config<R: Runtime>(config: RAGConfig) -> TauriPlugin<R> {
    PluginBuilder::new().with_config(config).build()
}

/// Initialize the RAG plugin with MCP support enabled.
pub fn init_with_mcp<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new().enable_mcp().build()
}

/// Initialize the RAG plugin with custom configuration and MCP support.
pub fn init_with_config_and_mcp<R: Runtime>(config: RAGConfig) -> TauriPlugin<R> {
    PluginBuilder::new()
        .with_config(config)
        .enable_mcp()
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_creation() {
        let _plugin = init::<tauri::Wry>();
        // Plugin creation succeeds
        assert!(true);
    }

    #[test]
    fn test_plugin_builder() {
        let _plugin = PluginBuilder::new()
            .with_config(RAGConfig::default())
            .enable_mcp()
            .build::<tauri::Wry>();
        // Plugin builder works
        assert!(true);
    }

    #[test]
    fn test_plugin_with_mcp() {
        let _plugin = init_with_mcp::<tauri::Wry>();
        // Plugin with MCP creation succeeds
        assert!(true);
    }

    #[test]
    fn test_plugin_with_config_and_mcp() {
        let config = RAGConfig::default();
        let _plugin = init_with_config_and_mcp::<tauri::Wry>(config);
        // Plugin with config and MCP creation succeeds
        assert!(true);
    }
}