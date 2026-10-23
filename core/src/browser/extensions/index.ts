/**
 * Inference extension. Start, stop and inference models.
 */
export { InferenceExtension } from './inference'

/**
 * MCP extension for managing tools and server communication.
 */
export { MCPExtension } from './mcp'

/**
 * Base AI Engines.
 */
export * from './engines'

export { RAGExtension, RAG_INTERNAL_SERVER } from './rag'
export type { AttachmentInput, IngestAttachmentsResult } from './rag'
export { VectorDBExtension } from './vector-db'
export type { SearchMode, VectorDBStatus, VectorChunkInput, VectorSearchResult, AttachmentFileInfo, VectorDBFileInput, VectorDBIngestOptions } from './vector-db'
