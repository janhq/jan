// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Core RAG system implementation.

pub mod database;
pub mod document_extraction;
pub mod embeddings;
pub mod system;
pub mod text_processing;

pub use system::RAGSystem;
pub use database::RAGDatabase;
pub use embeddings::EmbeddingsGenerator;
pub use text_processing::TextProcessor;
pub use document_extraction::extract_text_from_file;