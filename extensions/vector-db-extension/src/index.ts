import { VectorDBExtension, type SearchMode, type VectorDBStatus, type VectorChunkInput, type VectorSearchResult, type AttachmentFileInfo } from '@janhq/core'
import * as vecdb from '@janhq/tauri-plugin-vector-db-api'

export default class VectorDBExt extends VectorDBExtension {
  async onLoad(): Promise<void> {
    // no-op
  }

  onUnload(): void {}

  async getStatus(): Promise<VectorDBStatus> {
    return await vecdb.getStatus() as VectorDBStatus
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    return await vecdb.createCollection(name, dimension)
  }

  async insertChunks(collection: string, chunks: VectorChunkInput[]): Promise<void> {
    return await vecdb.insertChunks(collection, chunks)
  }

  async searchCollection(
    collection: string,
    query_embedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]> {
    return await vecdb.searchCollection(collection, query_embedding, limit, threshold, mode, fileIds) as VectorSearchResult[]
  }

  async deleteChunks(collection: string, ids: string[]): Promise<void> {
    return await vecdb.deleteChunks(collection, ids)
  }

  async deleteCollection(collection: string): Promise<void> {
    return await vecdb.deleteCollection(collection)
  }

  async chunkText(text: string, chunkSize: number, chunkOverlap: number): Promise<string[]> {
    return await vecdb.chunkText(text, chunkSize, chunkOverlap)
  }

  async listAttachments(collection: string, limit?: number): Promise<AttachmentFileInfo[]> {
    return await vecdb.listAttachments(collection, limit) as AttachmentFileInfo[]
  }

  async getChunks(
    collection: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]> {
    return await vecdb.getChunks(collection, fileId, startOrder, endOrder) as VectorSearchResult[]
  }
}
