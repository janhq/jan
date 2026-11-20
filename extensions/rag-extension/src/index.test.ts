import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as ragApi from '@janhq/tauri-plugin-rag-api'
import { ServiceKeys, type VectorDBService } from '@janhq/core'
import { activate, applySetting, type Rag, type RagConfig } from './index'
import { fakeContext } from './test/fake-context'

function parsePayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text)
}

// What each test sets as the vector DB; read through the service registry
// on every call, as the extension does.
let vectorDB: Partial<VectorDBService> | undefined
const engine = () => window.core.engineManager.get as ReturnType<typeof vi.fn>

const useVectorDB = (v: Partial<VectorDBService>) => void (vectorDB = v)

let config: RagConfig

async function activated(settings = {}) {
  const fake = fakeContext({ settings })
  const services = fake.services
  const get = services.get.bind(services)
  services.get = ((key) =>
    key.id === ServiceKeys.VectorDB.id ? vectorDB : get(key)) as typeof services.get
  await activate(fake.ctx)
  return fake
}

async function makeExt(): Promise<Rag> {
  const fake = await activated()
  const rag = fake.services.get(ServiceKeys.RAG) as Rag
  config = (rag as unknown as { config: RagConfig }).config
  return rag
}

describe('tool registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vectorDB = undefined
  })

  it('registers the three tools on the internal tool registry', async () => {
    const { tools } = await activated()
    expect(tools.names()).toEqual(['list_attachments', 'retrieve', 'get_chunks'])
    expect(tools.definitions().every((t) => t.server === 'rag-internal')).toBe(true)
  })

  it('caps retrieve top_k at the current retrieval limit', async () => {
    const { tools, settings } = await activated({ retrieval_limit: 5 })
    const topK = () =>
      (tools.definitions().find((t) => t.name === 'retrieve')!.inputSchema as {
        properties: { top_k: { maximum: number } }
      }).properties.top_k.maximum
    expect(topK()).toBe(5)
    await settings.api.set('retrieval_limit', 8)
    expect(topK()).toBe(8)
  })

  it('routes a registry call to the tool', async () => {
    const { tools } = await activated()
    const res = await tools.call('list_attachments', { scope: 'thread' })
    expect(res.error).toBe('Missing thread_id')
  })

  it('callTool returns an error result for an unknown tool', async () => {
    const ext = await makeExt()
    const res = await ext.callTool('nope', {})
    expect(res.error).toBe('Unknown tool: nope')
    expect(res.content[0].text).toContain('Unknown tool: nope')
  })

  it('releases its tools and services when disposed', async () => {
    const { ctx, tools, services } = await activated()
    ctx.subscriptions.dispose()
    expect(tools.names()).toEqual([])
    expect(services.get(ServiceKeys.RAG)).toBeUndefined()
  })
})

describe('listAttachments', () => {
  let ext: Rag

  beforeEach(async () => {
    vi.clearAllMocks()
    vectorDB = undefined
    ext = await makeExt()
  })

  it('errors when thread_id is missing for thread scope', async () => {
    const res = await ext.callTool('list_attachments', { scope: 'thread' })
    expect(res.error).toBe('Missing thread_id')
  })

  it('errors when the vector DB service is not provided', async () => {
    const res = await ext.callTool('list_attachments', { thread_id: 't1' })
    expect(res.error).toContain('missing listAttachments')
  })

  it('lists thread-level attachments', async () => {
    const files = [{ file_id: 'f1', name: 'a.txt' }]
    const listAttachments = vi.fn().mockResolvedValue(files)
    useVectorDB({ listAttachments })
    const res = await ext.callTool('list_attachments', { thread_id: 't1' })
    expect(listAttachments).toHaveBeenCalledWith('t1')
    const payload = parsePayload(res)
    expect(payload.scope).toBe('thread')
    expect(payload.attachments).toEqual(files)
    expect(res.error).toBe('')
  })

  it('lists project-level attachments when scope is project', async () => {
    const listAttachmentsForProject = vi.fn().mockResolvedValue([])
    const listAttachments = vi.fn()
    useVectorDB({
      listAttachmentsForProject,
      listAttachments,
    })
    const res = await ext.callTool('list_attachments', {
      thread_id: 'p1',
      scope: 'project',
    })
    expect(listAttachmentsForProject).toHaveBeenCalledWith('p1')
    expect(listAttachments).not.toHaveBeenCalled()
    expect(parsePayload(res).attachments).toEqual([])
  })

  it('captures thrown errors', async () => {
    useVectorDB({
      listAttachments: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const res = await ext.callTool('list_attachments', { thread_id: 't1' })
    expect(res.error).toBe('boom')
    expect(res.content[0].text).toContain('List attachments failed')
  })
})

describe('retrieve', () => {
  let ext: Rag

  beforeEach(async () => {
    vi.clearAllMocks()
    vectorDB = undefined
    ext = await makeExt()
  })

  it('reports disabled feature', async () => {
    config.enabled = false
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('Attachments feature disabled')
  })

  it('errors on missing query', async () => {
    const res = await ext.callTool('retrieve', { thread_id: 't1' })
    expect(res.error).toContain('Missing thread_id, project_id, or query')
  })

  it('errors when the vector DB service is not provided', async () => {
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('RAG dependencies not available')
  })

  it('errors when embeddings cannot be computed', async () => {
    useVectorDB({ searchCollection: vi.fn() })
    engine().mockReturnValue({ embed: vi.fn().mockResolvedValue({ data: [] }) })
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('Failed to compute embeddings')
  })

  it('orchestrates embedding then thread search and maps citations', async () => {
    const searchCollection = vi.fn().mockResolvedValue([
      { id: 'c1', text: 'hello', score: 0.9, file_id: 'f1', chunk_file_order: 2 },
    ])
    useVectorDB({ searchCollection })
    const embed = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: [0.1, 0.2], index: 0 }] })
    engine().mockReturnValue({ embed })

    const res = await ext.callTool('retrieve', {
      thread_id: 't1',
      query: 'q',
      top_k: 5,
    })

    expect(embed).toHaveBeenCalledWith(['q'])
    expect(searchCollection).toHaveBeenCalledWith(
      't1',
      [0.1, 0.2],
      5,
      0.3,
      'auto',
      undefined
    )
    const payload = parsePayload(res)
    expect(payload.citations).toEqual([
      { id: 'c1', text: 'hello', score: 0.9, file_id: 'f1', chunk_file_order: 2 },
    ])
    expect(payload.mode).toBe('auto')
  })

  it('uses project search and project_id as effective thread when scope is project', async () => {
    const searchCollectionForProject = vi.fn().mockResolvedValue([])
    useVectorDB({ searchCollectionForProject })
    engine().mockReturnValue({
      embed: vi.fn().mockResolvedValue({ data: [{ embedding: [1], index: 0 }] }),
    })

    const res = await ext.callTool('retrieve', {
      project_id: 'p1',
      query: 'q',
      scope: 'project',
      file_ids: ['f1'],
    })

    expect(searchCollectionForProject).toHaveBeenCalledWith(
      'p1',
      [1],
      3,
      0.3,
      'auto',
      ['f1']
    )
    expect(parsePayload(res).scope).toBe('project')
  })

  it('captures search errors', async () => {
    useVectorDB({
      searchCollection: vi.fn().mockRejectedValue(new Error('db down')),
    })
    engine().mockReturnValue({
      embed: vi.fn().mockResolvedValue({ data: [{ embedding: [1], index: 0 }] }),
    })
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('db down')
    expect(res.content[0].text).toContain('Retrieve failed')
  })

  // Rust plugin errors arrive as { VariantName: "message" }; the message is
  // what the model can act on, not the wrapper.
  it('unwraps a plugin error variant instead of dumping its JSON', async () => {
    useVectorDB({
      searchCollection: vi
        .fn()
        .mockRejectedValue({ InvalidInput: 'embedding is empty' }),
    })
    engine().mockReturnValue({
      embed: vi.fn().mockResolvedValue({ data: [{ embedding: [1], index: 0 }] }),
    })
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('embedding is empty')
  })
})

describe('getChunks', () => {
  let ext: Rag

  beforeEach(async () => {
    vi.clearAllMocks()
    vectorDB = undefined
    ext = await makeExt()
  })

  it('errors on missing parameters', async () => {
    const res = await ext.callTool('get_chunks', { thread_id: 't1', file_id: 'f1' })
    expect(res.error).toContain('Missing thread_id, file_id, start_order')
  })

  it('errors when the vector DB service is not provided', async () => {
    const res = await ext.callTool('get_chunks', {
      thread_id: 't1',
      file_id: 'f1',
      start_order: 0,
      end_order: 1,
    })
    expect(res.error).toBe('Vector DB extension not available')
    expect(res.content[0].text).toContain('Vector DB extension not available')
  })

  it('returns chunks from thread scope', async () => {
    const getChunks = vi.fn().mockResolvedValue([{ order: 0, text: 'x' }])
    useVectorDB({ getChunks })
    const res = await ext.callTool('get_chunks', {
      thread_id: 't1',
      file_id: 'f1',
      start_order: 0,
      end_order: 2,
    })
    expect(getChunks).toHaveBeenCalledWith('t1', 'f1', 0, 2)
    const payload = parsePayload(res)
    expect(payload.chunks).toEqual([{ order: 0, text: 'x' }])
    expect(payload.file_id).toBe('f1')
  })

  it('supports start_order = end_order = 0 (single chunk)', async () => {
    const getChunks = vi.fn().mockResolvedValue([])
    useVectorDB({ getChunks })
    const res = await ext.callTool('get_chunks', {
      thread_id: 't1',
      file_id: 'f1',
      start_order: 0,
      end_order: 0,
    })
    expect(getChunks).toHaveBeenCalledWith('t1', 'f1', 0, 0)
    expect(res.error).toBe('')
  })

  it('uses project scope helper', async () => {
    const getChunksForProject = vi.fn().mockResolvedValue([])
    useVectorDB({ getChunksForProject })
    await ext.callTool('get_chunks', {
      thread_id: 'p1',
      file_id: 'f1',
      start_order: 1,
      end_order: 3,
      scope: 'project',
    })
    expect(getChunksForProject).toHaveBeenCalledWith('p1', 'f1', 1, 3)
  })
})

describe('ingestAttachments', () => {
  let ext: Rag

  beforeEach(async () => {
    vi.clearAllMocks()
    vectorDB = undefined
    ext = await makeExt()
  })

  it('returns empty result for no files', async () => {
    const res = await ext.ingestAttachments('t1', [])
    expect(res).toEqual({ filesProcessed: 0, chunksInserted: 0, files: [] })
  })

  it('does nothing when disabled', async () => {
    config.enabled = false
    const res = await ext.ingestAttachments('t1', [{ path: '/a.txt' }])
    expect(res.filesProcessed).toBe(0)
  })

  it('throws when the vector DB service is not provided', async () => {
    await expect(
      ext.ingestAttachments('t1', [{ path: '/a.txt' }])
    ).rejects.toThrow('Vector DB extension not available')
  })

  it('enforces the file size limit', async () => {
    config.maxFileSizeMB = 1
    useVectorDB({
      createCollection: vi.fn(),
      insertChunks: vi.fn(),
      ingestFile: vi.fn(),
    })
    await expect(
      ext.ingestAttachments('t1', [
        { path: '/big.txt', name: 'big.txt', size: 2 * 1024 * 1024 },
      ])
    ).rejects.toThrow('exceeds size limit')
  })

  it('ingests files and sums chunk counts', async () => {
    const ingestFile = vi
      .fn()
      .mockResolvedValueOnce({ file_id: 'f1', chunk_count: 3 })
      .mockResolvedValueOnce({ file_id: 'f2', chunk_count: 2 })
    useVectorDB({
      createCollection: vi.fn(),
      insertChunks: vi.fn(),
      ingestFile,
    })
    const res = await ext.ingestAttachments('t1', [
      { path: '/a.txt', name: 'a.txt' },
      { path: '/b.txt' },
    ])
    expect(res.filesProcessed).toBe(2)
    expect(res.chunksInserted).toBe(5)
    expect(ingestFile).toHaveBeenCalledWith(
      't1',
      { path: '/a.txt', name: 'a.txt', type: undefined, size: undefined },
      { chunkSize: 512, chunkOverlap: 64 }
    )
  })

  it('skips files without a path', async () => {
    const ingestFile = vi.fn()
    useVectorDB({ ingestFile })
    const res = await ext.ingestAttachments('t1', [{ path: '' }])
    expect(res.filesProcessed).toBe(0)
    expect(ingestFile).not.toHaveBeenCalled()
  })
})

describe('ingestAttachmentsForProject', () => {
  let ext: Rag

  beforeEach(async () => {
    vi.clearAllMocks()
    vectorDB = undefined
    ext = await makeExt()
  })

  it('returns empty for missing project id or files', async () => {
    expect(await ext.ingestAttachmentsForProject('', [{ path: '/a' }])).toEqual({
      filesProcessed: 0,
      chunksInserted: 0,
      files: [],
    })
  })

  it('throws when the vector DB service is not provided', async () => {
    await expect(
      ext.ingestAttachmentsForProject('p1', [{ path: '/a.txt' }])
    ).rejects.toThrow('Vector DB extension not available')
  })

  it('ingests project files', async () => {
    const ingestFileForProject = vi
      .fn()
      .mockResolvedValue({ file_id: 'f1', chunk_count: 4 })
    useVectorDB({ ingestFileForProject })
    const res = await ext.ingestAttachmentsForProject('p1', [
      { path: '/a.txt', name: 'a.txt' },
    ])
    expect(res.chunksInserted).toBe(4)
    expect(ingestFileForProject).toHaveBeenCalledWith(
      'p1',
      { path: '/a.txt', name: 'a.txt', type: undefined, size: undefined },
      { chunkSize: 512, chunkOverlap: 64 }
    )
  })
})

describe('parseDocument and embed', () => {
  let ext: Rag

  beforeEach(async () => {
    vi.clearAllMocks()
    vectorDB = undefined
    ext = await makeExt()
  })

  it('delegates parseDocument with a default mime type', async () => {
    ;vi.mocked(ragApi.parseDocument).mockResolvedValue('text')
    const out = await ext.parseDocument('/a.pdf')
    expect(out).toBe('text')
    expect(ragApi.parseDocument).toHaveBeenCalledWith(
      '/a.pdf',
      'application/octet-stream'
    )
  })

  it('passes an explicit mime type through', async () => {
    ;vi.mocked(ragApi.parseDocument).mockResolvedValue('t')
    await ext.parseDocument('/a.txt', 'text/plain')
    expect(ragApi.parseDocument).toHaveBeenCalledWith('/a.txt', 'text/plain')
  })

  it('embed returns [] for empty input without touching the engine', async () => {
    expect(await ext.embed([])).toEqual([])
    expect(engine()).not.toHaveBeenCalled()
  })

  it('embed places vectors at their reported index', async () => {
    engine().mockReturnValue({
      embed: vi.fn().mockResolvedValue({
        data: [
          { embedding: [2], index: 1 },
          { embedding: [1], index: 0 },
        ],
      }),
    })
    expect(await ext.embed(['a', 'b'])).toEqual([[1], [2]])
  })

  it('embed throws when llamacpp is unavailable', async () => {
    engine().mockReturnValue(undefined)
    await expect(ext.embed(['a'])).rejects.toThrow('llamacpp extension not available')
  })
})

describe('settings', () => {
  it('starts from the stored settings', async () => {
    vectorDB = undefined
    await makeExt()
    expect(config).toMatchObject({ retrievalLimit: 3, chunkSizeChars: 512, overlapChars: 64 })
    const { services } = await activated({ retrieval_limit: 9, search_mode: 'ann', enabled: false })
    const rag = services.get(ServiceKeys.RAG) as unknown as { config: RagConfig }
    expect(rag.config).toMatchObject({ retrievalLimit: 9, searchMode: 'ann', enabled: false })
  })

  it('follows setting changes', async () => {
    const { services, settings } = await activated()
    await settings.api.set('max_file_size_mb', 50)
    await settings.api.set('parse_mode', 'embeddings')
    const rag = services.get(ServiceKeys.RAG) as unknown as { config: RagConfig }
    expect(rag.config).toMatchObject({ maxFileSizeMB: 50, parseMode: 'embeddings' })
  })

  it('migrates the legacy localStorage settings before reading them', async () => {
    localStorage.setItem(
      '@janhq/rag-extension',
      JSON.stringify([{ key: 'retrieval_limit', controllerProps: { value: 6 } }])
    )
    const { services } = await activated()
    const rag = services.get(ServiceKeys.RAG) as unknown as { config: RagConfig }
    expect(rag.config.retrievalLimit).toBe(6)
    expect(localStorage.getItem('@janhq/rag-extension')).toBeNull()
  })

  it('applySetting coerces values and ignores unknown keys', () => {
    const cfg = { ...config }
    applySetting(cfg, 'enabled', false)
    applySetting(cfg, 'max_file_size_mb', '50')
    applySetting(cfg, 'search_mode', 'ann')
    expect(cfg).toMatchObject({ enabled: false, maxFileSizeMB: 50, searchMode: 'ann' })
    const before = { ...cfg }
    applySetting(cfg, 'bogus', 123)
    expect(cfg).toEqual(before)
  })
})
