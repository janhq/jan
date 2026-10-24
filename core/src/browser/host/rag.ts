export type SearchMode = 'auto' | 'ann' | 'linear'

export interface VectorDBStatus {
  ann_available: boolean
}

export interface VectorChunkInput {
  text: string
  embedding: number[]
}

export interface VectorSearchResult {
  id: string
  text: string
  score?: number
  file_id: string
  chunk_file_order: number
}

export interface AttachmentFileInfo {
  id: string
  name?: string
  path?: string
  type?: string
  size?: number
  chunk_count: number
}

export interface VectorDBFileInput {
  path: string
  name?: string
  type?: string
  size?: number
}

export interface VectorDBIngestOptions {
  chunkSize: number
  chunkOverlap: number
}

export interface AttachmentInput {
  path: string
  name?: string
  type?: string
  size?: number
}

export interface IngestAttachmentsResult {
  filesProcessed: number
  chunksInserted: number
  files: AttachmentFileInfo[]
}

/** The server name the RAG tools are listed under. */
export const RAG_INTERNAL_SERVER = 'rag-internal'

/**
 * Local vector storage and search, as the vector-db built-in provides it.
 * Thread methods take a thread id, project methods a project id; the
 * service maps each to its own collection.
 */
export interface VectorDBService {
  getStatus(): Promise<VectorDBStatus>
  createCollection(threadId: string, dimension: number): Promise<void>
  insertChunks(threadId: string, fileId: string, chunks: VectorChunkInput[]): Promise<void>
  ingestFile(
    threadId: string,
    file: VectorDBFileInput,
    opts: VectorDBIngestOptions
  ): Promise<AttachmentFileInfo>
  searchCollection(
    threadId: string,
    queryEmbedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]>
  deleteChunks(threadId: string, ids: string[]): Promise<void>
  deleteFile(threadId: string, fileId: string): Promise<void>
  deleteCollection(threadId: string): Promise<void>
  listAttachments(threadId: string, limit?: number): Promise<AttachmentFileInfo[]>
  getChunks(
    threadId: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]>

  createCollectionForProject(projectId: string, dimension: number): Promise<void>
  insertChunksForProject(
    projectId: string,
    fileId: string,
    chunks: VectorChunkInput[]
  ): Promise<void>
  ingestFileForProject(
    projectId: string,
    file: VectorDBFileInput,
    opts: VectorDBIngestOptions
  ): Promise<AttachmentFileInfo>
  searchCollectionForProject(
    projectId: string,
    queryEmbedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]>
  deleteChunksForProject(projectId: string, ids: string[]): Promise<void>
  deleteFileForProject(projectId: string, fileId: string): Promise<void>
  deleteCollectionForProject(projectId: string): Promise<void>
  listAttachmentsForProject(projectId: string, limit?: number): Promise<AttachmentFileInfo[]>
  getChunksForProject(
    projectId: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]>
}

/**
 * Document ingestion, parsing and embedding, as the rag built-in provides
 * it. Its retrieval tools go through the internal tool registry instead.
 */
export interface RAGIngestService {
  ingestAttachments(threadId: string, files: AttachmentInput[]): Promise<IngestAttachmentsResult>
  /** Into the project collection, shared by every thread of the project. */
  ingestAttachmentsForProject(
    projectId: string,
    files: AttachmentInput[]
  ): Promise<IngestAttachmentsResult>
  /** Plain text of a document, for inline use. */
  parseDocument(path: string, type?: string): Promise<string>
  /** One vector per text, in input order. */
  embed(texts: string[]): Promise<number[][]>
}
