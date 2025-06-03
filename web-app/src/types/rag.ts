/**
 * Shared RAG types and constants
 */

// RAG Document interface - centralized definition
export interface RAGDocument {
  source_id: string
  path: string
  filename: string
  file_type: string
  status: RAGDocumentStatus
  created_at: string
  updated_at: string
  metadata?: Record<string, unknown>
  error_message?: string
  chunk_count?: number
  file_size?: number
}

// RAG Document Status
export type RAGDocumentStatus = 'processing' | 'indexed' | 'error'

// RAG Query Result
export interface RAGQueryResult {
  query: string
  total_results: number
  retrieved_contexts: Array<{
    document_id: string
    text_chunk: string
    similarity_score: number
    distance: number
    metadata: {
      original_document_path: string
      document_type: string
      chunk_order: number
      source_id: string
    }
  }>
  source_info: Record<string, {
    name: string
    type: string
    status: string
    added_at: string
  }>
  query_timestamp: string
}

// Upload status
export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

// Sort options
export type SortOption = 'name' | 'date' | 'size' | 'chunks'
export type SortDirection = 'asc' | 'desc'

// Type for MCP source data
export interface MCPSource {
  source_id: string
  path?: string
  path_or_url?: string
  filename?: string
  file_type?: string
  status?: RAGDocumentStatus
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
  chunk_count?: number
  file_size?: number
  error_message?: string
}

// File type mappings
export const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: '📄',
  txt: '📝',
  md: '📝',
  docx: '📘',
  html: '🌐',
  csv: '📊',
  json: '📋',
  image: '🖼️'
} as const

// Status configurations
export const STATUS_CONFIG = {
  indexed: {
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: 'CheckCircleIcon'
  },
  processing: {
    color: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: 'ClockIcon'
  },
  error: {
    color: 'bg-red-50 text-red-700 border-red-200',
    icon: 'AlertCircleIcon'
  }
} as const

// Supported file types
export const SUPPORTED_FILE_TYPES = [
  '.pdf',
  '.txt', 
  '.md',
  '.docx',
  '.html',
  '.csv',
  '.json'
] as const

// File size limits
export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB