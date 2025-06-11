// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

/**
 * TypeScript bindings for the Tauri RAG plugin.
 * 
 * This module provides a TypeScript interface to interact with the RAG 
 * (Retrieval-Augmented Generation) functionality in Tauri applications.
 */

// Import will be resolved at runtime
declare function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>

// Type definitions

export interface EmbeddingConfig {
  base_url: string
  api_key?: string
  model: string
  dimensions: number
  batch_size: number
}

export interface ChunkingConfig {
  chunk_size: number
  overlap: number
}

export interface RAGConfig {
  database_path?: string
  embedding_config: EmbeddingConfig
  chunking_config: ChunkingConfig
}

export interface SourceInfo {
  id: string
  source_id: string
  type: string
  name: string
  path: string
  filename: string
  file_type: string
  status: string
  created_at: string
  updated_at: string
  added_at: string
  metadata?: Record<string, any>
  chunk_count: number
  file_size: number
  error_message?: string
}

export interface QueryResult {
  content: string
  source_id: string
  score: number
  chunk_id: string
  metadata?: Record<string, any>
}

export interface AddSourceParams {
  source_type: string
  path: string
  content: string
  metadata?: Record<string, any>
}

export interface QueryParams {
  query_text: string
  top_k?: number
  filters?: Record<string, string>
}

export interface AddSourceResult {
  status: string
  source_id: string
  message: string
  chunk_count: number
}

export interface QueryDocumentsResult {
  query: string
  total_results: number
  retrieved_contexts: Array<{
    document_id: string
    text_chunk: string
    similarity_score: number
    distance: number
    chunk_id: string
    metadata?: Record<string, any>
  }>
  source_info: Record<string, any>
  query_timestamp: string
}

export interface ConfigUpdateResponse {
  status: string
  message: string
}

// RAG API class

export class RAG {
  /**
   * Initialize the RAG system
   */
  static async initialize(): Promise<string> {
    return await invoke('plugin:rag|initialize_rag')
  }

  /**
   * Add a data source to the RAG system
   */
  static async addDataSource(
    sourceType: string,
    pathOrUrl: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    return await invoke('plugin:rag|add_data_source', {
      sourceType,
      pathOrUrl,
      content,
      metadata
    })
  }

  /**
   * List all data sources
   */
  static async listDataSources(): Promise<SourceInfo[]> {
    const result = await invoke<string>('plugin:rag|list_data_sources')
    const parsed = JSON.parse(result)
    return parsed.sources
  }

  /**
   * Remove a data source
   */
  static async removeDataSource(sourceId: string): Promise<string> {
    return await invoke('plugin:rag|remove_data_source', { sourceId })
  }

  /**
   * Query documents using vector similarity search
   */
  static async queryDocuments(
    query: string,
    topK?: number,
    filters?: Record<string, any>
  ): Promise<QueryDocumentsResult> {
    const result = await invoke<string>('plugin:rag|query_documents', {
      query,
      topK,
      filters
    })
    return JSON.parse(result)
  }

  /**
   * Clean all data sources
   */
  static async cleanAllDataSources(): Promise<string> {
    return await invoke('plugin:rag|clean_all_data_sources')
  }

  /**
   * Reset the database
   */
  static async resetDatabase(): Promise<string> {
    return await invoke('plugin:rag|reset_database')
  }

  /**
   * Get RAG system status
   */
  static async getStatus(): Promise<string> {
    return await invoke('plugin:rag|get_rag_status')
  }

  /**
   * Get current embedding configuration
   */
  static async getEmbeddingConfig(): Promise<EmbeddingConfig> {
    const result = await invoke<string>('plugin:rag|get_embedding_config')
    const parsed = JSON.parse(result)
    return parsed.embedding_config
  }

  /**
   * Update embedding configuration
   */
  static async updateEmbeddingConfig(config: EmbeddingConfig): Promise<ConfigUpdateResponse> {
    const result = await invoke<string>('plugin:rag|update_embedding_config', {
      embeddingConfig: config
    })
    return JSON.parse(result)
  }

  /**
   * Get current chunking configuration
   */
  static async getChunkingConfig(): Promise<ChunkingConfig> {
    const result = await invoke<string>('plugin:rag|get_chunking_config')
    const parsed = JSON.parse(result)
    return parsed.chunking_config
  }

  /**
   * Update chunking configuration
   */
  static async updateChunkingConfig(config: ChunkingConfig): Promise<ConfigUpdateResponse> {
    const result = await invoke<string>('plugin:rag|update_chunking_config', {
      chunkingConfig: config
    })
    return JSON.parse(result)
  }
}

// Convenience functions

/**
 * Initialize RAG system with default settings
 */
export async function initializeRAG(): Promise<string> {
  return RAG.initialize()
}

/**
 * Add a text document to the RAG system
 */
export async function addTextDocument(
  name: string,
  content: string,
  metadata?: Record<string, any>
): Promise<AddSourceResult> {
  const result = await RAG.addDataSource('text', name, content, metadata)
  return JSON.parse(result)
}

/**
 * Add a file to the RAG system
 */
export async function addFileDocument(
  filePath: string,
  metadata?: Record<string, any>
): Promise<AddSourceResult> {
  const result = await RAG.addDataSource('file', filePath, '', metadata)
  return JSON.parse(result)
}

/**
 * Search for documents using natural language query
 */
export async function searchDocuments(
  query: string,
  maxResults: number = 3,
  sourceFilter?: string
): Promise<QueryDocumentsResult> {
  const filters = sourceFilter ? { source_id: sourceFilter } : undefined
  return RAG.queryDocuments(query, maxResults, filters)
}

/**
 * Get all indexed documents
 */
export async function getIndexedDocuments(): Promise<SourceInfo[]> {
  return RAG.listDataSources()
}

/**
 * Remove a document from the index
 */
export async function removeDocument(sourceId: string): Promise<boolean> {
  const result = await RAG.removeDataSource(sourceId)
  const parsed = JSON.parse(result)
  return parsed.removed === true
}

/**
 * Configure RAG system for OpenAI embeddings
 */
export async function configureOpenAI(
  apiKey: string,
  model: string = 'text-embedding-ada-002'
): Promise<ConfigUpdateResponse> {
  const config: EmbeddingConfig = {
    base_url: 'https://api.openai.com',
    api_key: apiKey,
    model,
    dimensions: 1536,
    batch_size: 100
  }
  return RAG.updateEmbeddingConfig(config)
}

/**
 * Configure RAG system for local embeddings
 */
export async function configureLocalEmbeddings(
  baseUrl: string,
  model: string,
  dimensions: number
): Promise<ConfigUpdateResponse> {
  const config: EmbeddingConfig = {
    base_url: baseUrl,
    model,
    dimensions,
    batch_size: 100
  }
  return RAG.updateEmbeddingConfig(config)
}

/**
 * Configure text chunking settings
 */
export async function configureChunking(
  chunkSize: number = 1000,
  overlap: number = 100
): Promise<ConfigUpdateResponse> {
  const config: ChunkingConfig = {
    chunk_size: chunkSize,
    overlap
  }
  return RAG.updateChunkingConfig(config)
}

// Export everything
export default RAG