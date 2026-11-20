import {
  ServiceKeys,
  embedTexts,
  type AttachmentFileInfo,
  type AttachmentInput,
  type IngestAttachmentsResult,
  type InternalExtensionContext,
  type MCPToolCallResult,
  type RAGIngestService,
  type SearchMode,
  type VectorDBFileInput,
  type VectorDBIngestOptions,
  type VectorDBService,
} from '@janhq/core'
import * as ragApi from '@janhq/tauri-plugin-rag-api'
import { getRAGTools, RETRIEVE, LIST_ATTACHMENTS, GET_CHUNKS } from './tools'
import { migrateLegacySettings, type SettingValue } from './settings'

type ParseMode = 'auto' | 'inline' | 'embeddings' | 'prompt'

export interface RagConfig {
  enabled: boolean
  retrievalLimit: number
  retrievalThreshold: number
  chunkSizeChars: number
  overlapChars: number
  searchMode: SearchMode
  maxFileSizeMB: number
  parseMode: ParseMode
  autoInlineContextRatio: number
}

const DEFAULT_CONFIG: RagConfig = {
  enabled: true,
  retrievalLimit: 3,
  retrievalThreshold: 0.3,
  chunkSizeChars: 512,
  overlapChars: 64,
  searchMode: 'auto',
  maxFileSizeMB: 100,
  parseMode: 'auto',
  autoInlineContextRatio: 0.75,
}

/** Applies one stored setting to the config; unknown keys are ignored. */
export function applySetting(config: RagConfig, key: string, value: SettingValue): void {
  switch (key) {
    case 'enabled':
      config.enabled = Boolean(value)
      break
    case 'max_file_size_mb':
      config.maxFileSizeMB = Number(value)
      break
    case 'auto_inline_context_ratio':
      config.autoInlineContextRatio = Number(value)
      break
    case 'retrieval_limit':
      config.retrievalLimit = Number(value)
      break
    case 'retrieval_threshold':
      config.retrievalThreshold = Number(value)
      break
    case 'chunk_size_chars':
      config.chunkSizeChars = Number(value)
      break
    case 'overlap_chars':
      config.overlapChars = Number(value)
      break
    case 'search_mode':
      config.searchMode = String(value) as SearchMode
      break
    case 'parse_mode':
      config.parseMode = String(value) as ParseMode
      break
  }
}

const SETTING_KEYS = [
  'enabled',
  'max_file_size_mb',
  'auto_inline_context_ratio',
  'retrieval_limit',
  'retrieval_threshold',
  'chunk_size_chars',
  'overlap_chars',
  'search_mode',
  'parse_mode',
]

const failure = (error: string, text: string = error): MCPToolCallResult => ({
  error,
  content: [{ type: 'text', text }],
})

const success = (payload: unknown): MCPToolCallResult => ({
  error: '',
  content: [{ type: 'text', text: JSON.stringify(payload) }],
})

// Rust plugin errors arrive as { VariantName: "message" }; the message is
// what the model can act on, not the wrapper.
function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const values = Object.values(e as Record<string, unknown>)
    return values.length === 1 && typeof values[0] === 'string'
      ? values[0]
      : JSON.stringify(e)
  }
  return 'Unknown error'
}

export async function activate(ctx: InternalExtensionContext): Promise<void> {
  const config: RagConfig = { ...DEFAULT_CONFIG }
  // Before the first read, so the values the user set before the host
  // existed are what the config starts from.
  try {
    await migrateLegacySettings(ctx.settings)
  } catch (e) {
    ctx.log.error('[RAG] migrating legacy settings failed:', e)
  }
  try {
    for (const key of SETTING_KEYS) {
      const value = await ctx.settings.get(key)
      if (value !== undefined) applySetting(config, key, value)
    }
  } catch (e) {
    ctx.log.error('[RAG] reading settings failed:', e)
  }
  ctx.subscriptions.add(
    ctx.settings.onDidChange(({ key, value }) => applySetting(config, key, value))
  )

  const rag = new Rag(ctx, config)
  ctx.subscriptions.add(ctx.internal.services.provide(ServiceKeys.RAG, rag))
  for (const tool of getRAGTools(config.retrievalLimit)) {
    ctx.subscriptions.add(
      ctx.internal.tools.register({
        name: tool.name,
        // Rebuilt per read: the retrieve schema caps top_k at the current limit.
        definition: () =>
          getRAGTools(config.retrievalLimit).find((t) => t.name === tool.name) ?? tool,
        call: (args) => rag.callTool(tool.name, args),
      })
    )
  }
  void rag.checkANNAvailability()
}

export class Rag implements RAGIngestService {
  constructor(
    private readonly ctx: InternalExtensionContext,
    private readonly config: RagConfig
  ) {}

  private vectorDB(): VectorDBService | undefined {
    return this.ctx.internal.services.get(ServiceKeys.VectorDB)
  }

  async checkANNAvailability(): Promise<void> {
    try {
      const vec = this.vectorDB()
      if (!vec) return
      const status = await vec.getStatus()
      this.ctx.log.info(
        '[RAG] Vector DB ANN support:',
        status.ann_available ? 'AVAILABLE' : 'NOT AVAILABLE'
      )
      if (!status.ann_available) {
        this.ctx.log.warn(
          '[RAG] Warning: sqlite-vec not loaded. Collections will use slower linear search.'
        )
      }
    } catch (e) {
      this.ctx.log.error('[RAG] Failed to check ANN status:', e)
    }
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    switch (toolName) {
      case LIST_ATTACHMENTS:
        return this.listAttachments(args)
      case RETRIEVE:
        return this.retrieve(args)
      case GET_CHUNKS:
        return this.getChunks(args)
      default:
        return failure(`Unknown tool: ${toolName}`)
    }
  }

  private async listAttachments(args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const threadId = String(args['thread_id'] || '')
    const scope = String(args['scope'] || 'thread')

    if (!threadId && scope === 'thread') return failure('Missing thread_id')
    try {
      const vec = this.vectorDB()
      if (!vec) return failure('Vector DB extension missing listAttachments')
      const files: AttachmentFileInfo[] =
        scope === 'project'
          ? await vec.listAttachmentsForProject(threadId)
          : await vec.listAttachments(threadId)
      return success({ thread_id: threadId, scope, attachments: files || [] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      return failure(msg, `List attachments failed: ${JSON.stringify(msg)}`)
    }
  }

  private async retrieve(args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const threadId = String(args['thread_id'] || '')
    const projectId = String(args['project_id'] || '')
    const query = String(args['query'] || '')
    const fileIds = args['file_ids'] as string[] | undefined
    const scope = String(args['scope'] || 'thread')

    // Use project_id as threadId when scope is project
    const effectiveThreadId = scope === 'project' ? projectId || threadId : threadId

    const s = this.config
    const topK = (args['top_k'] as number) || s.retrievalLimit || 3
    const threshold = s.retrievalThreshold ?? 0.3
    const mode: SearchMode = s.searchMode || 'auto'

    if (s.enabled === false) {
      return failure(
        'Attachments feature disabled',
        'Attachments are disabled in Settings. Enable them to use retrieval.'
      )
    }
    if (
      !query ||
      (!threadId && scope === 'thread') ||
      (scope === 'project' && !effectiveThreadId)
    ) {
      return failure('Missing thread_id, project_id, or query', 'Missing required parameters')
    }

    try {
      const vec = this.vectorDB()
      if (!vec) return failure('RAG dependencies not available', 'Vector DB extension not available')

      const queryEmb = (await embedTexts([query]))?.[0]
      if (!queryEmb) return failure('Failed to compute embeddings')

      const results =
        scope === 'project'
          ? await vec.searchCollectionForProject(
              effectiveThreadId,
              queryEmb,
              topK,
              threshold,
              mode,
              fileIds
            )
          : await vec.searchCollection(effectiveThreadId, queryEmb, topK, threshold, mode, fileIds)

      return success({
        thread_id: threadId,
        project_id: projectId,
        scope,
        query,
        citations:
          results?.map((r) => ({
            id: r.id,
            text: r.text,
            score: r.score,
            file_id: r.file_id,
            chunk_file_order: r.chunk_file_order,
          })) ?? [],
        mode,
      })
    } catch (e) {
      this.ctx.log.error('[RAG] Retrieve error:', e)
      const msg = errorText(e)
      return failure(msg, `Retrieve failed: ${msg}`)
    }
  }

  private async getChunks(args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const threadId = String(args['thread_id'] || '')
    const fileId = String(args['file_id'] || '')
    const startOrder = args['start_order'] as number | undefined
    const endOrder = args['end_order'] as number | undefined
    const scope = String(args['scope'] || 'thread')

    if (
      !fileId ||
      startOrder === undefined ||
      endOrder === undefined ||
      (!threadId && scope === 'thread')
    ) {
      return failure(
        'Missing thread_id, file_id, start_order, or end_order',
        'Missing required parameters'
      )
    }

    try {
      const vec = this.vectorDB()
      if (!vec) return failure('Vector DB extension not available')
      const chunks =
        scope === 'project'
          ? await vec.getChunksForProject(threadId, fileId, startOrder, endOrder)
          : await vec.getChunks(threadId, fileId, startOrder, endOrder)
      return success({ thread_id: threadId, scope, file_id: fileId, chunks: chunks || [] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      return failure(msg, `Get chunks failed: ${msg}`)
    }
  }

  async ingestAttachmentsForProject(
    projectId: string,
    files: AttachmentInput[]
  ): Promise<IngestAttachmentsResult> {
    if (!projectId || !Array.isArray(files) || files.length === 0) {
      return { filesProcessed: 0, chunksInserted: 0, files: [] }
    }
    if (this.config.enabled === false) {
      return { filesProcessed: 0, chunksInserted: 0, files: [] }
    }
    const vec = this.vectorDB()
    if (!vec) throw new Error('Vector DB extension not available')
    return this.ingest(files, (file, opts) => vec.ingestFileForProject(projectId, file, opts))
  }

  async ingestAttachments(
    threadId: string,
    files: AttachmentInput[]
  ): Promise<IngestAttachmentsResult> {
    if (!threadId || !Array.isArray(files) || files.length === 0) {
      return { filesProcessed: 0, chunksInserted: 0, files: [] }
    }
    if (this.config.enabled === false) {
      return { filesProcessed: 0, chunksInserted: 0, files: [] }
    }
    const vec = this.vectorDB()
    if (!vec) throw new Error('Vector DB extension not available')
    return this.ingest(files, (file, opts) => vec.ingestFile(threadId, file, opts))
  }

  private async ingest(
    files: AttachmentInput[],
    ingestFile: (
      file: VectorDBFileInput,
      opts: VectorDBIngestOptions
    ) => Promise<AttachmentFileInfo>
  ): Promise<IngestAttachmentsResult> {
    const s = this.config
    const maxSize = s.maxFileSizeMB || undefined
    let totalChunks = 0
    const processedFiles: AttachmentFileInfo[] = []

    for (const f of files) {
      if (!f?.path) continue
      if (maxSize && f.size && f.size > maxSize * 1024 * 1024) {
        throw new Error(`File '${f.name}' exceeds size limit (${f.size} bytes > ${maxSize} MB).`)
      }
      const fileName = f.name || f.path.split(/[\\/]/).pop()
      const info = await ingestFile(
        { path: f.path, name: fileName, type: f.type, size: f.size },
        { chunkSize: s.chunkSizeChars ?? 512, chunkOverlap: s.overlapChars ?? 64 }
      )
      totalChunks += Number(info?.chunk_count || 0)
      processedFiles.push(info)
    }

    return {
      filesProcessed: processedFiles.length,
      chunksInserted: totalChunks,
      files: processedFiles,
    }
  }

  async parseDocument(path: string, type?: string): Promise<string> {
    return await ragApi.parseDocument(path, type || 'application/octet-stream')
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return []
    return embedTexts(texts)
  }
}
