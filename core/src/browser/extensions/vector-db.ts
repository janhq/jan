import { BaseExtension, ExtensionTypeEnum } from '../extension'

export type SearchMode = 'auto' | 'ann' | 'linear'

export interface VectorDBStatus {
  ann_available: boolean
}

export interface VectorChunkInput {
  id?: string
  text: string
  embedding: number[]
  metadata?: Record<string, any>
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

/**
 * Vector DB extension base: abstraction over local vector storage and search.
 */
export abstract class VectorDBExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.VectorDB
  }

  abstract getStatus(): Promise<VectorDBStatus>
  abstract createCollection(name: string, dimension: number): Promise<void>
  abstract insertChunks(collection: string, chunks: VectorChunkInput[]): Promise<void>
  abstract searchCollection(
    collection: string,
    query_embedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]>
  abstract deleteChunks(collection: string, ids: string[]): Promise<void>
  abstract deleteCollection(collection: string): Promise<void>
  abstract chunkText(text: string, chunkSize: number, chunkOverlap: number): Promise<string[]>
  abstract listAttachments(collection: string, limit?: number): Promise<AttachmentFileInfo[]>
  abstract getChunks(
    collection: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]>
}
