import {
  RAGExtension,
  MCPTool,
  MCPToolCallResult,
  ExtensionTypeEnum,
  VectorDBExtension,
  type AttachmentInput,
  type SettingComponentProps,
  AIEngine,
  type AttachmentFileInfo,
} from '@janhq/core'
import './env.d'
import { getRAGTools, RETRIEVE, LIST_ATTACHMENTS, GET_CHUNKS } from './tools'
import * as ragApi from '@janhq/tauri-plugin-rag-api'

export default class RagExtension extends RAGExtension {
  private config = {
    enabled: true,
    retrievalLimit: 3,
    retrievalThreshold: 0.3,
    chunkSizeChars: 512,
    overlapChars: 64,
    searchMode: 'auto' as 'auto' | 'ann' | 'linear',
    maxFileSizeMB: 20,
    parseMode: 'auto' as 'auto' | 'inline' | 'embeddings' | 'prompt',
    autoInlineContextRatio: 0.75,
  }

  async onLoad(): Promise<void> {
    this.configure()
    // Check ANN availability on load
    this.checkANNAvailability()
  }

  onUnload(): void {}

  async configure() {
    const settings = structuredClone(SETTINGS) as SettingComponentProps[]
    await this.registerSettings(settings)
    this.config.enabled = await this.getSetting('enabled', this.config.enabled)
    this.config.maxFileSizeMB = await this.getSetting(
      'max_file_size_mb',
      this.config.maxFileSizeMB
    )
    this.config.retrievalLimit = await this.getSetting(
      'retrieval_limit',
      this.config.retrievalLimit
    )
    this.config.retrievalThreshold = await this.getSetting(
      'retrieval_threshold',
      this.config.retrievalThreshold
    )
    // Prefer char-based keys; fall back to legacy token keys for backward compatibility
    this.config.chunkSizeChars =
      (await this.getSetting('chunk_size_chars', this.config.chunkSizeChars)) ||
      (await this.getSetting('chunk_size_tokens', this.config.chunkSizeChars))
    this.config.overlapChars =
      (await this.getSetting('overlap_chars', this.config.overlapChars)) ||
      (await this.getSetting('overlap_tokens', this.config.overlapChars))
    this.config.searchMode = await this.getSetting(
      'search_mode',
      this.config.searchMode
    )
    this.config.parseMode = await this.getSetting(
      'parse_mode',
      this.config.parseMode
    )
    this.config.autoInlineContextRatio = await this.getSetting(
      'auto_inline_context_ratio',
      this.config.autoInlineContextRatio
    )
  }

  async checkANNAvailability(): Promise<boolean> {
    try {
      const vec = window.core?.extensionManager.get(
        ExtensionTypeEnum.VectorDB
      ) as unknown as VectorDBExtension
      if (vec?.getStatus) {
        const status = await vec.getStatus()
        console.log(
          '[RAG] Vector DB ANN support:',
          status.ann_available ? '✓ AVAILABLE' : '✗ NOT AVAILABLE'
        )
        if (!status.ann_available) {
          console.warn(
            '[RAG] Warning: sqlite-vec not loaded. Collections will use slower linear search.'
          )
        }
      }
    } catch (e) {
      console.error('[RAG] Failed to check ANN status:', e)
    }
  }

  async getTools(): Promise<MCPTool[]> {
    return getRAGTools(this.config.retrievalLimit)
  }

  async getToolNames(): Promise<string[]> {
    // Keep this in sync with getTools() but without building full schemas
    return [LIST_ATTACHMENTS, RETRIEVE, GET_CHUNKS]
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    switch (toolName) {
      case LIST_ATTACHMENTS:
        return this.listAttachments(args)
      case RETRIEVE:
        return this.retrieve(args)
      case GET_CHUNKS:
        return this.getChunks(args)
      default:
        return {
          error: `Unknown tool: ${toolName}`,
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        }
    }
  }

  private async listAttachments(
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    const threadId = String(args['thread_id'] || '')
    if (!threadId) {
      return {
        error: 'Missing thread_id',
        content: [{ type: 'text', text: 'Missing thread_id' }],
      }
    }
    try {
      const vec = window.core?.extensionManager.get(
        ExtensionTypeEnum.VectorDB
      ) as unknown as VectorDBExtension
      if (!vec?.listAttachments) {
        return {
          error: 'Vector DB extension missing listAttachments',
          content: [
            {
              type: 'text',
              text: 'Vector DB extension missing listAttachments',
            },
          ],
        }
      }
      const files = await vec.listAttachments(threadId)
      return {
        error: '',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              thread_id: threadId,
              attachments: files || [],
            }),
          },
        ],
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        error: msg,
        content: [{ type: 'text', text: `List attachments failed: ${msg}` }],
      }
    }
  }

  private async retrieve(
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    const threadId = String(args['thread_id'] || '')
    const query = String(args['query'] || '')
    const fileIds = args['file_ids'] as string[] | undefined

    const s = this.config
    const topK = (args['top_k'] as number) || s.retrievalLimit || 3
    const threshold = s.retrievalThreshold ?? 0.3
    const mode: 'auto' | 'ann' | 'linear' = s.searchMode || 'auto'

    if (s.enabled === false) {
      return {
        error: 'Attachments feature disabled',
        content: [
          {
            type: 'text',
            text: 'Attachments are disabled in Settings. Enable them to use retrieval.',
          },
        ],
      }
    }
    if (!threadId || !query) {
      return {
        error: 'Missing thread_id or query',
        content: [{ type: 'text', text: 'Missing required parameters' }],
      }
    }

    try {
      // Resolve extensions
      const vec = window.core?.extensionManager.get(
        ExtensionTypeEnum.VectorDB
      ) as unknown as VectorDBExtension
      if (!vec?.searchCollection) {
        return {
          error: 'RAG dependencies not available',
          content: [
            { type: 'text', text: 'Vector DB extension not available' },
          ],
        }
      }

      const queryEmb = (await this.embedTexts([query]))?.[0]
      if (!queryEmb) {
        return {
          error: 'Failed to compute embeddings',
          content: [{ type: 'text', text: 'Failed to compute embeddings' }],
        }
      }

      const results = await vec.searchCollection(
        threadId,
        queryEmb,
        topK,
        threshold,
        mode,
        fileIds
      )

      const payload = {
        thread_id: threadId,
        query,
        citations:
          results?.map((r: any) => ({
            id: r.id,
            text: r.text,
            score: r.score,
            file_id: r.file_id,
            chunk_file_order: r.chunk_file_order,
          })) ?? [],
        mode,
      }
      return {
        error: '',
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      }
    } catch (e) {
      console.error('[RAG] Retrieve error:', e)
      let msg = 'Unknown error'
      if (e instanceof Error) {
        msg = e.message
      } else if (typeof e === 'string') {
        msg = e
      } else if (e && typeof e === 'object') {
        msg = JSON.stringify(e)
      }
      return {
        error: msg,
        content: [{ type: 'text', text: `Retrieve failed: ${msg}` }],
      }
    }
  }

  private async getChunks(
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    const threadId = String(args['thread_id'] || '')
    const fileId = String(args['file_id'] || '')
    const startOrder = args['start_order'] as number | undefined
    const endOrder = args['end_order'] as number | undefined

    if (
      !threadId ||
      !fileId ||
      startOrder === undefined ||
      endOrder === undefined
    ) {
      return {
        error: 'Missing thread_id, file_id, start_order, or end_order',
        content: [{ type: 'text', text: 'Missing required parameters' }],
      }
    }

    try {
      const vec = window.core?.extensionManager.get(
        ExtensionTypeEnum.VectorDB
      ) as unknown as VectorDBExtension
      if (!vec?.getChunks) {
        return {
          error: 'Vector DB extension not available',
          content: [
            { type: 'text', text: 'Vector DB extension not available' },
          ],
        }
      }

      const chunks = await vec.getChunks(threadId, fileId, startOrder, endOrder)

      const payload = {
        thread_id: threadId,
        file_id: fileId,
        chunks: chunks || [],
      }
      return {
        error: '',
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        error: msg,
        content: [{ type: 'text', text: `Get chunks failed: ${msg}` }],
      }
    }
  }

  // Desktop-only ingestion by file paths
  async ingestAttachments(
    threadId: string,
    files: AttachmentInput[]
  ): Promise<{
    filesProcessed: number
    chunksInserted: number
    files: AttachmentFileInfo[]
  }> {
    if (!threadId || !Array.isArray(files) || files.length === 0) {
      return { filesProcessed: 0, chunksInserted: 0, files: [] }
    }

    // Respect feature flag: do nothing when disabled
    if (this.config.enabled === false) {
      return { filesProcessed: 0, chunksInserted: 0, files: [] }
    }

    const vec = window.core?.extensionManager.get(
      ExtensionTypeEnum.VectorDB
    ) as unknown as VectorDBExtension
    if (!vec?.createCollection || !vec?.insertChunks) {
      throw new Error('Vector DB extension not available')
    }

    // Load settings
    const s = this.config
    const maxSize = (s?.enabled === false ? 0 : s?.maxFileSizeMB) || undefined
    const chunkSize = s?.chunkSizeChars as number | undefined
    const chunkOverlap = s?.overlapChars as number | undefined

    let totalChunks = 0
    const processedFiles: AttachmentFileInfo[] = []

    for (const f of files) {
      if (!f?.path) continue
      if (maxSize && f.size && f.size > maxSize * 1024 * 1024) {
        throw new Error(
          `File '${f.name}' exceeds size limit (${f.size} bytes > ${maxSize} MB).`
        )
      }

      const fileName = f.name || f.path.split(/[\\/]/).pop()
      // Preferred/required path: let Vector DB extension handle full file ingestion
      const canIngestFile = typeof (vec as any)?.ingestFile === 'function'
      if (!canIngestFile) {
        console.error(
          '[RAG] Vector DB extension missing ingestFile; cannot ingest document'
        )
        continue
      }
      const info = await (vec as VectorDBExtension).ingestFile(
        threadId,
        { path: f.path, name: fileName, type: f.type, size: f.size },
        { chunkSize: chunkSize ?? 512, chunkOverlap: chunkOverlap ?? 64 }
      )
      totalChunks += Number(info?.chunk_count || 0)
      processedFiles.push(info)
    }

    // Return files we ingested with real IDs directly from ingestFile
    return {
      filesProcessed: processedFiles.length,
      chunksInserted: totalChunks,
      files: processedFiles,
    }
  }

  onSettingUpdate<T>(key: string, value: T): void {
    switch (key) {
      case 'enabled':
        this.config.enabled = Boolean(value)
        break
      case 'max_file_size_mb':
        this.config.maxFileSizeMB = Number(value)
        break
      case 'auto_inline_context_ratio':
        this.config.autoInlineContextRatio = Number(value)
        break
      case 'retrieval_limit':
        this.config.retrievalLimit = Number(value)
        break
      case 'retrieval_threshold':
        this.config.retrievalThreshold = Number(value)
        break
      case 'chunk_size_chars':
        this.config.chunkSizeChars = Number(value)
        break
      case 'overlap_chars':
        this.config.overlapChars = Number(value)
        break
      case 'search_mode':
        this.config.searchMode = String(value) as 'auto' | 'ann' | 'linear'
        break
      case 'parse_mode':
        this.config.parseMode = String(value) as
          | 'auto'
          | 'inline'
          | 'embeddings'
          | 'prompt'
        break
    }
  }

  async parseDocument(path: string, type?: string): Promise<string> {
    return await ragApi.parseDocument(path, type || 'application/octet-stream')
  }

  // Locally implement embedding logic (previously in embeddings-extension)
  private async embedTexts(texts: string[]): Promise<number[][]> {
    const llm = window.core?.extensionManager.getByName(
      '@janhq/llamacpp-extension'
    ) as AIEngine & {
      embed?: (
        texts: string[]
      ) => Promise<{ data: Array<{ embedding: number[]; index: number }> }>
    }
    if (!llm?.embed) throw new Error('llamacpp extension not available')
    const res = await llm.embed(texts)
    const data: Array<{ embedding: number[]; index: number }> = res?.data || []
    const out: number[][] = new Array(texts.length)
    for (const item of data) {
      out[item.index] = item.embedding
    }
    return out
  }
}
