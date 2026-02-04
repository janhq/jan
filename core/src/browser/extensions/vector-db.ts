import { BaseExtension, ExtensionTypeEnum } from '../extension'

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

// High-level input types for file ingestion
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

/**
 * Vector DB extension base: abstraction over local vector storage and search.
 */
export abstract class VectorDBExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.VectorDB
  }

  abstract getStatus(): Promise<VectorDBStatus>
  abstract createCollection(threadId: string, dimension: number): Promise<void>
  abstract insertChunks(
    threadId: string,
    fileId: string,
    chunks: VectorChunkInput[]
  ): Promise<void>
  abstract ingestFile(
    threadId: string,
    file: VectorDBFileInput,
    opts: VectorDBIngestOptions
  ): Promise<AttachmentFileInfo>
  abstract searchCollection(
    threadId: string,
    query_embedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]>
  abstract deleteChunks(threadId: string, ids: string[]): Promise<void>
  abstract deleteFile(threadId: string, fileId: string): Promise<void>
  abstract deleteCollection(threadId: string): Promise<void>
  abstract listAttachments(threadId: string, limit?: number): Promise<AttachmentFileInfo[]>
  abstract getChunks(
    threadId: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]>
<<<<<<< HEAD
=======

  // Project-level operations (shared across all threads in a project)
  abstract createCollectionForProject(projectId: string, dimension: number): Promise<void>
  abstract insertChunksForProject(
    projectId: string,
    fileId: string,
    chunks: VectorChunkInput[]
  ): Promise<void>
  abstract ingestFileForProject(
    projectId: string,
    file: VectorDBFileInput,
    opts: VectorDBIngestOptions
  ): Promise<AttachmentFileInfo>
  abstract searchCollectionForProject(
    projectId: string,
    query_embedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]>
  abstract deleteChunksForProject(projectId: string, ids: string[]): Promise<void>
  abstract deleteFileForProject(projectId: string, fileId: string): Promise<void>
  abstract deleteCollectionForProject(projectId: string): Promise<void>
  abstract listAttachmentsForProject(projectId: string, limit?: number): Promise<AttachmentFileInfo[]>
  abstract getChunksForProject(
    projectId: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}
