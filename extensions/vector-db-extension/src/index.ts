import { VectorDBExtension, type SearchMode, type VectorDBStatus, type VectorChunkInput, type VectorSearchResult, type AttachmentFileInfo, type VectorDBFileInput, type VectorDBIngestOptions, AIEngine } from '@janhq/core'
import * as vecdb from '@janhq/tauri-plugin-vector-db-api'
import * as ragApi from '@janhq/tauri-plugin-rag-api'

// Conservative average for English/dense text; real tokenizers vary (CJK
// runs closer to 1-2 chars/token), so this stays a deliberate underestimate
// rather than an exact conversion.
const CHARS_PER_TOKEN_ESTIMATE = 3
const CONTEXT_SAFETY_MARGIN = 0.8
const MIN_CHUNK_SIZE_CHARS = 64
// Reserves room for BOS/special tokens the tokenizer adds beyond raw content.
const EMBEDDING_CONTEXT_SAFETY_TOKENS = 8

export default class VectorDBExt extends VectorDBExtension {
  async onLoad(): Promise<void> {
    // no-op
  }

  onUnload(): void {}

  async getStatus(): Promise<VectorDBStatus> {
    return await vecdb.getStatus() as VectorDBStatus
  }

  private collectionForThread(threadId: string): string {
    return `attachments_${threadId}`
  }

  private collectionForProject(projectId: string): string {
    return `project_${projectId}`
  }

  async createCollectionForProject(projectId: string, dimension: number): Promise<void> {
    return await vecdb.createCollection(this.collectionForProject(projectId), dimension)
  }

  async createCollection(threadId: string, dimension: number): Promise<void> {
    return await vecdb.createCollection(this.collectionForThread(threadId), dimension)
  }

  async insertChunks(threadId: string, fileId: string, chunks: VectorChunkInput[]): Promise<void> {
    return await vecdb.insertChunks(this.collectionForThread(threadId), fileId, chunks)
  }

  async searchCollection(
    threadId: string,
    query_embedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]> {
    return await vecdb.searchCollection(this.collectionForThread(threadId), query_embedding, limit, threshold, mode, fileIds) as VectorSearchResult[]
  }

  async deleteChunks(threadId: string, ids: string[]): Promise<void> {
    return await vecdb.deleteChunks(this.collectionForThread(threadId), ids)
  }

  async deleteCollection(threadId: string): Promise<void> {
    return await vecdb.deleteCollection(this.collectionForThread(threadId))
  }

  async insertChunksForProject(projectId: string, fileId: string, chunks: VectorChunkInput[]): Promise<void> {
    return await vecdb.insertChunks(this.collectionForProject(projectId), fileId, chunks)
  }

  async searchCollectionForProject(
    projectId: string,
    query_embedding: number[],
    limit: number,
    threshold: number,
    mode?: SearchMode,
    fileIds?: string[]
  ): Promise<VectorSearchResult[]> {
    return await vecdb.searchCollection(this.collectionForProject(projectId), query_embedding, limit, threshold, mode, fileIds) as VectorSearchResult[]
  }

  async deleteChunksForProject(projectId: string, ids: string[]): Promise<void> {
    return await vecdb.deleteChunks(this.collectionForProject(projectId), ids)
  }

  async deleteCollectionForProject(projectId: string): Promise<void> {
    return await vecdb.deleteCollection(this.collectionForProject(projectId))
  }

  async ingestFileForProject(projectId: string, file: VectorDBFileInput, opts: VectorDBIngestOptions): Promise<AttachmentFileInfo> {
    // First, parse the document and get embeddings to determine dimension
    const text = await ragApi.parseDocument(file.path, file.type || 'application/octet-stream')
    const chunks = await this.chunkText(text, opts.chunkSize, opts.chunkOverlap)

    // Get embeddings to determine dimension - use a default if no chunks
    let dimension = 0
    if (chunks.length > 0) {
      const embeddings = await this.embedTexts(chunks)
      dimension = embeddings[0]?.length || 0
    }

    // Ensure collection exists (use default dimension 384 if no embeddings yet)
    const collectionDimension = dimension > 0 ? dimension : 384
    await this.createCollectionForProject(projectId, collectionDimension)

    // Now check for duplicates
    const existingFiles = await vecdb.listAttachments(this.collectionForProject(projectId)).catch(() => [])
    const duplicate = existingFiles.find((f: any) => f.name === file.name && f.path === file.path)
    if (duplicate) {
      throw new Error(`File '${file.name}' has already been attached to this project`)
    }

    if (!chunks.length) {
      const fi = await vecdb.createFile(this.collectionForProject(projectId), file)
      return fi
    }

    // Re-embed if we got dimension from createCollection
    const embeddings = await this.embedTexts(chunks)
    const finalDimension = embeddings[0]?.length || 0
    if (finalDimension <= 0) throw new Error('Embedding dimension not available')

    // Ensure collection has correct dimension
    if (finalDimension !== collectionDimension) {
      await this.deleteCollectionForProject(projectId)
      await this.createCollectionForProject(projectId, finalDimension)
    }

    const fi = await vecdb.createFile(this.collectionForProject(projectId), file)
    await vecdb.insertChunks(
      this.collectionForProject(projectId),
      fi.id,
      chunks.map((t, i) => ({ text: t, embedding: embeddings[i] }))
    )
    const infos = await vecdb.listAttachments(this.collectionForProject(projectId))
    const updated = infos.find((e) => e.id === fi.id)
    return updated || { ...fi, chunk_count: chunks.length }
  }

  async listAttachmentsForProject(projectId: string, limit?: number): Promise<AttachmentFileInfo[]> {
    return await vecdb.listAttachments(this.collectionForProject(projectId), limit) as AttachmentFileInfo[]
  }

  async getChunksForProject(
    projectId: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]> {
    return await vecdb.getChunks(this.collectionForProject(projectId), fileId, startOrder, endOrder) as VectorSearchResult[]
  }

  async deleteFileForProject(projectId: string, fileId: string): Promise<void> {
    return await vecdb.deleteFile(this.collectionForProject(projectId), fileId)
  }

  // Optional helper for chunking
  private async chunkText(text: string, chunkSize: number, chunkOverlap: number): Promise<string[]> {
    const safeChunkSize = await this.clampToEmbeddingContext(chunkSize, chunkOverlap)
    const rawChunks = await vecdb.chunkText(text, safeChunkSize, chunkOverlap)
    return await this.ensureChunksFitEmbeddingContext(rawChunks)
  }

  /**
   * chunk_text (Rust) splits by raw character count with no tokenizer
   * awareness. Clamp the char budget to the embedding model's real n_ctx so
   * most chunks fit on the first try (cheap, but only an estimate).
   */
  private async clampToEmbeddingContext(chunkSize: number, chunkOverlap: number): Promise<number> {
    const llm = this.getEmbeddingEngine()
    if (!llm?.getEmbeddingContextSize) return chunkSize
    const ctxSize = await this.probeEmbeddingContextSize(llm)
    if (!ctxSize || ctxSize <= 0) return chunkSize
    const safeMaxChars = Math.floor(
      ctxSize * CHARS_PER_TOKEN_ESTIMATE * CONTEXT_SAFETY_MARGIN
    )
    const budget = Math.max(MIN_CHUNK_SIZE_CHARS, safeMaxChars - chunkOverlap)
    return Math.min(chunkSize, budget)
  }

  /**
   * Character-based estimates can't be trusted for every tokenizer/content
   * mix (subword tokenizers on dense text can run well under the assumed
   * chars-per-token ratio). Verify each chunk against the embedding model's
   * real tokenizer and recursively halve any chunk that still doesn't fit,
   * so ingestion can never hit exceed_context_size_error.
   */
  private async ensureChunksFitEmbeddingContext(chunks: string[]): Promise<string[]> {
    const llm = this.getEmbeddingEngine()
    if (!llm?.getEmbeddingContextSize || !llm?.countEmbeddingTokens) return chunks
    const ctxSize = await this.probeEmbeddingContextSize(llm)
    if (!ctxSize || ctxSize <= 0) return chunks
    const budget = Math.max(1, ctxSize - EMBEDDING_CONTEXT_SAFETY_TOKENS)

    const out: string[] = []
    for (const chunk of chunks) {
      out.push(...(await this.splitChunkToFit(chunk, budget, llm)))
    }
    return out
  }

  /**
   * A rejected probe/count means the embedding engine is unhealthy (e.g. the
   * embedding model failed to load). Skipping verification here would let
   * oversized chunks through and surface later as a confusing HTTP 400
   * (exceed_context_size_error), so fail ingestion with the real cause.
   */
  private async probeEmbeddingContextSize(llm: {
    getEmbeddingContextSize?: () => Promise<number | undefined>
  }): Promise<number | undefined> {
    try {
      return await llm.getEmbeddingContextSize!()
    } catch (e) {
      throw new Error(
        `Failed to determine embedding context size: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  private async splitChunkToFit(
    text: string,
    budget: number,
    llm: { countEmbeddingTokens: (texts: string[]) => Promise<number[]> }
  ): Promise<string[]> {
    if (!text) return []
    let count: number
    try {
      ;[count] = await llm.countEmbeddingTokens([text])
    } catch (e) {
      throw new Error(
        `Failed to count embedding tokens: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    if (count <= budget || text.length <= MIN_CHUNK_SIZE_CHARS) return [text]
    const mid = Math.floor(text.length / 2)
    return [
      ...(await this.splitChunkToFit(text.slice(0, mid), budget, llm)),
      ...(await this.splitChunkToFit(text.slice(mid), budget, llm)),
    ]
  }

  private getEmbeddingEngine() {
    return window.core?.extensionManager.getByName('@janhq/llamacpp-extension') as AIEngine & {
      embed?: (texts: string[]) => Promise<{ data: Array<{ embedding: number[]; index: number }> }>
      getEmbeddingContextSize?: () => Promise<number | undefined>
      countEmbeddingTokens?: (texts: string[]) => Promise<number[]>
    }
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    const llm = this.getEmbeddingEngine()
    if (!llm?.embed) throw new Error('llamacpp extension not available')

    const res = await llm.embed(texts)
    const data: Array<{ embedding: number[]; index: number }> = res?.data || []
    const out: number[][] = new Array(texts.length)
    for (const item of data) {
      out[item.index] = item.embedding
    }
    return out
  }

  async ingestFile(threadId: string, file: VectorDBFileInput, opts: VectorDBIngestOptions): Promise<AttachmentFileInfo> {
    // Check for duplicate file (same name + path)
    const existingFiles = await vecdb.listAttachments(this.collectionForThread(threadId)).catch(() => [])
    const duplicate = existingFiles.find((f: any) => f.name === file.name && f.path === file.path)
    if (duplicate) {
      throw new Error(`File '${file.name}' has already been attached to this thread`)
    }

    const text = await ragApi.parseDocument(file.path, file.type || 'application/octet-stream')
    const chunks = await this.chunkText(text, opts.chunkSize, opts.chunkOverlap)
    if (!chunks.length) {
      const fi = await vecdb.createFile(this.collectionForThread(threadId), file)
      return fi
    }
    const embeddings = await this.embedTexts(chunks)
    const dimension = embeddings[0]?.length || 0
    if (dimension <= 0) throw new Error('Embedding dimension not available')
    await this.createCollection(threadId, dimension)
    const fi = await vecdb.createFile(this.collectionForThread(threadId), file)
    await vecdb.insertChunks(
      this.collectionForThread(threadId),
      fi.id,
      chunks.map((t, i) => ({ text: t, embedding: embeddings[i] }))
    )
    const infos = await vecdb.listAttachments(this.collectionForThread(threadId))
    const updated = infos.find((e) => e.id === fi.id)
    return updated || { ...fi, chunk_count: chunks.length }
  }

  async listAttachments(threadId: string, limit?: number): Promise<AttachmentFileInfo[]> {
    return await vecdb.listAttachments(this.collectionForThread(threadId), limit) as AttachmentFileInfo[]
  }

  async getChunks(
    threadId: string,
    fileId: string,
    startOrder: number,
    endOrder: number
  ): Promise<VectorSearchResult[]> {
    return await vecdb.getChunks(this.collectionForThread(threadId), fileId, startOrder, endOrder) as VectorSearchResult[]
  }

  async deleteFile(threadId: string, fileId: string): Promise<void> {
    return await vecdb.deleteFile(this.collectionForThread(threadId), fileId)
  }
}
