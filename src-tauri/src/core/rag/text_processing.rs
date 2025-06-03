use anyhow::{Result, anyhow};
use sha2::{Sha256, Digest};
use hex;

use super::types::{DocumentChunk, ChunkingConfig};
use super::embeddings::EmbeddingsGenerator;
use crate::core::text_extraction;

/// Text processing utilities for the RAG system
pub struct TextProcessor {
    embeddings: EmbeddingsGenerator,
    chunking_config: ChunkingConfig,
}

impl TextProcessor {
    pub fn new(embeddings: EmbeddingsGenerator) -> Self {
        Self {
            embeddings,
            chunking_config: ChunkingConfig::default(),
        }
    }

    pub fn with_config(embeddings: EmbeddingsGenerator, chunking_config: ChunkingConfig) -> Self {
        Self {
            embeddings,
            chunking_config,
        }
    }

    /// Extract text content from a file if content is empty
    pub async fn extract_text_if_needed(&self, content: &str, source_type: &str, path: &str) -> Result<String> {
        if content.is_empty() && source_type == "file" {
            log::info!("Extracting text from file: {}", path);
            let extracted = text_extraction::extract_text_from_file_path(path).await?;
            log::info!("Extracted {} characters from file", extracted.len());
            Ok(extracted)
        } else {
            Ok(content.to_string())
        }
    }

    /// Process content into document chunks with embeddings
    pub async fn process_content_to_chunks(
        &self,
        content: &str,
        source_id: &str,
        path: &str,
        document_type: &str,
    ) -> Result<Vec<DocumentChunk>> {
        log::info!("Processing content into chunks: source_id={}, length={}", source_id, content.len());
        
        // Create text chunks
        let text_chunks = self.create_smart_chunks(
            content, 
            self.chunking_config.chunk_size, 
            self.chunking_config.overlap
        );
        
        log::info!("Created {} text chunks", text_chunks.len());
        
        // Generate embeddings for all chunks in batch
        let text_refs: Vec<&str> = text_chunks.iter().map(|s| s.as_str()).collect();
        let embeddings: Vec<Vec<f32>> = self.embeddings.create_embeddings(&text_refs).await?;
        
        log::info!("Generated {} embeddings", embeddings.len());
        
        // Create DocumentChunk objects
        let chunks: Vec<DocumentChunk> = text_chunks
            .into_iter()
            .zip(embeddings.into_iter())
            .enumerate()
            .map(|(i, (chunk_text, embedding))| {
                let chunk_id = self.generate_id(&format!("{}_chunk_{}", source_id, i));
                
                DocumentChunk {
                    id: chunk_id,
                    source_id: source_id.to_string(),
                    text_chunk: chunk_text,
                    vector: embedding,
                    original_document_path: path.to_string(),
                    document_type: document_type.to_string(),
                    chunk_order: i as i32,
                }
            })
            .collect();
        
        log::info!("Created {} document chunks", chunks.len());
        Ok(chunks)
    }

    /// Generate a single embedding for a query
    pub async fn generate_query_embedding(&self, text: &str) -> Result<Vec<f32>> {
        let embeddings = self.embeddings.create_embeddings(&[text]).await?;
        embeddings.into_iter().next()
            .ok_or_else(|| anyhow!("Failed to generate embedding"))
    }

    /// Update the chunking configuration
    pub fn update_chunking_config(&mut self, config: ChunkingConfig) {
        self.chunking_config = config;
    }

    /// Get the embedding dimension
    pub async fn embedding_dim(&self) -> usize {
        self.embeddings.embedding_dim().await
    }

    /// Generate a hash-based ID
    pub fn generate_id(&self, input: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Create chunks with smart boundary detection
    fn create_smart_chunks(&self, content: &str, target_size: usize, overlap: usize) -> Vec<String> {
        if content.is_empty() {
            return Vec::new();
        }
        
        let mut chunks = Vec::with_capacity((content.len() / (target_size - overlap)) + 1);
        let content_bytes = content.as_bytes();
        let mut byte_start = 0;
        
        while byte_start < content_bytes.len() {
            let byte_end = self.find_chunk_end(content, content_bytes, byte_start, target_size);
            
            // Extract and trim the chunk
            if let Ok(chunk) = std::str::from_utf8(&content_bytes[byte_start..byte_end]) {
                let trimmed = chunk.trim();
                if !trimmed.is_empty() {
                    chunks.push(trimmed.to_string());
                }
            }
            
            // Break if we've reached the end
            if byte_end >= content_bytes.len() {
                break;
            }
            
            // Calculate next start with overlap
            byte_start = self.calculate_next_start(content, content_bytes, byte_end, overlap, byte_start);
        }
        
        chunks
    }

    fn find_chunk_end(&self, content: &str, content_bytes: &[u8], byte_start: usize, target_size: usize) -> usize {
        // Find the byte position for our target character count
        let mut byte_end = byte_start;
        let mut char_count = 0;
        
        // Count characters up to target_size
        while byte_end < content_bytes.len() && char_count < target_size {
            if let Some(char_len) = content_bytes.get(byte_end..)
                .and_then(|bytes| std::str::from_utf8(bytes).ok())
                .and_then(|s| s.chars().next())
                .map(|c| c.len_utf8())
            {
                byte_end += char_len;
                char_count += 1;
            } else {
                break;
            }
        }
        
        // If we're not at the end, find a better boundary
        if byte_end < content_bytes.len() {
            if let Some(boundary) = self.find_smart_boundary(content, content_bytes, byte_end, target_size) {
                byte_end = boundary;
            }
        }
        
        // Ensure we're at a valid UTF-8 boundary
        while byte_end > byte_start && !content.is_char_boundary(byte_end) {
            byte_end -= 1;
        }
        
        byte_end
    }

    fn find_smart_boundary(&self, content: &str, content_bytes: &[u8], byte_end: usize, target_size: usize) -> Option<usize> {
        let search_start = byte_end.saturating_sub(target_size / 5);
        let search_slice = &content_bytes[search_start..byte_end];
        
        // Look for sentence boundaries first
        for (i, &byte) in search_slice.iter().enumerate().rev() {
            let pos = search_start + i;
            
            if matches!(byte, b'.' | b'!' | b'?') {
                if content.is_char_boundary(pos + 1) {
                    if pos + 1 >= content_bytes.len() || content_bytes[pos + 1].is_ascii_whitespace() {
                        return Some(pos + 1);
                    }
                }
            }
        }
        
        // If no sentence boundary, find word boundary
        for (i, &byte) in search_slice.iter().enumerate().rev() {
            if byte.is_ascii_whitespace() {
                let pos = search_start + i;
                if content.is_char_boundary(pos) {
                    return Some(pos);
                }
            }
        }
        
        None
    }

    fn calculate_next_start(&self, content: &str, content_bytes: &[u8], byte_end: usize, overlap: usize, current_start: usize) -> usize {
        let overlap_start = byte_end.saturating_sub(overlap);
        let mut next_start = overlap_start;
        
        // Find the start of the next word (skip partial words)
        while next_start > current_start && next_start < content_bytes.len() {
            if content.is_char_boundary(next_start) {
                if next_start == 0 || content_bytes[next_start - 1].is_ascii_whitespace() {
                    break;
                }
            }
            next_start = next_start.saturating_sub(1);
        }
        
        // Skip leading whitespace
        while next_start < content_bytes.len() && content_bytes[next_start].is_ascii_whitespace() {
            next_start += 1;
        }
        
        next_start
    }
}

impl Clone for TextProcessor {
    fn clone(&self) -> Self {
        Self {
            embeddings: self.embeddings.clone(),
            chunking_config: self.chunking_config.clone(),
        }
    }
}