import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as ragApi from '@janhq/tauri-plugin-rag-api'
import RagExtension from './index'

function parsePayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text)
}

function extMgr() {
  return window.core!.extensionManager as unknown as {
    get: ReturnType<typeof vi.fn>
    getByName: ReturnType<typeof vi.fn>
  }
}

function makeExt(): RagExtension {
  return new (RagExtension as any)()
}

describe('RagExtension tool metadata', () => {
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('getTools returns the three tools', async () => {
    const tools = await ext.getTools()
    expect(tools.map((t) => t.name)).toEqual([
      'list_attachments',
      'retrieve',
      'get_chunks',
    ])
  })

  it('getToolNames mirrors the registered tools', async () => {
    expect(await ext.getToolNames()).toEqual([
      'list_attachments',
      'retrieve',
      'get_chunks',
    ])
  })

  it('callTool returns an error result for an unknown tool', async () => {
    const res = await ext.callTool('nope', {})
    expect(res.error).toBe('Unknown tool: nope')
    expect(res.content[0].text).toContain('Unknown tool: nope')
  })
})

describe('listAttachments', () => {
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('errors when thread_id is missing for thread scope', async () => {
    const res = await ext.callTool('list_attachments', { scope: 'thread' })
    expect(res.error).toBe('Missing thread_id')
  })

  it('errors when the vector DB extension lacks list methods', async () => {
    extMgr().get.mockReturnValue({})
    const res = await ext.callTool('list_attachments', { thread_id: 't1' })
    expect(res.error).toContain('missing listAttachments')
  })

  it('lists thread-level attachments', async () => {
    const files = [{ file_id: 'f1', name: 'a.txt' }]
    const listAttachments = vi.fn().mockResolvedValue(files)
    extMgr().get.mockReturnValue({ listAttachments })
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
    extMgr().get.mockReturnValue({
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
    extMgr().get.mockReturnValue({
      listAttachments: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const res = await ext.callTool('list_attachments', { thread_id: 't1' })
    expect(res.error).toBe('boom')
    expect(res.content[0].text).toContain('List attachments failed')
  })
})

describe('retrieve', () => {
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('reports disabled feature', async () => {
    ;(ext as any).config.enabled = false
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('Attachments feature disabled')
  })

  it('errors on missing query', async () => {
    const res = await ext.callTool('retrieve', { thread_id: 't1' })
    expect(res.error).toContain('Missing thread_id, project_id, or query')
  })

  it('errors when vector DB search is unavailable', async () => {
    extMgr().get.mockReturnValue({})
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('RAG dependencies not available')
  })

  it('errors when embeddings cannot be computed', async () => {
    extMgr().get.mockReturnValue({ searchCollection: vi.fn() })
    extMgr().getByName.mockReturnValue({ embed: vi.fn().mockResolvedValue({ data: [] }) })
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('Failed to compute embeddings')
  })

  it('orchestrates embedding then thread search and maps citations', async () => {
    const searchCollection = vi.fn().mockResolvedValue([
      { id: 'c1', text: 'hello', score: 0.9, file_id: 'f1', chunk_file_order: 2 },
    ])
    extMgr().get.mockReturnValue({ searchCollection })
    const embed = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: [0.1, 0.2], index: 0 }] })
    extMgr().getByName.mockReturnValue({ embed })

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
    extMgr().get.mockReturnValue({ searchCollectionForProject })
    extMgr().getByName.mockReturnValue({
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
    extMgr().get.mockReturnValue({
      searchCollection: vi.fn().mockRejectedValue(new Error('db down')),
    })
    extMgr().getByName.mockReturnValue({
      embed: vi.fn().mockResolvedValue({ data: [{ embedding: [1], index: 0 }] }),
    })
    const res = await ext.callTool('retrieve', { thread_id: 't1', query: 'q' })
    expect(res.error).toBe('db down')
    expect(res.content[0].text).toContain('Retrieve failed')
  })
})

describe('getChunks', () => {
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('errors on missing parameters', async () => {
    const res = await ext.callTool('get_chunks', { thread_id: 't1', file_id: 'f1' })
    expect(res.error).toContain('Missing thread_id, file_id, start_order')
  })

  it('errors when vector DB is unavailable', async () => {
    extMgr().get.mockReturnValue({})
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
    extMgr().get.mockReturnValue({ getChunks })
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
    extMgr().get.mockReturnValue({ getChunks })
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
    extMgr().get.mockReturnValue({ getChunksForProject })
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
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('returns empty result for no files', async () => {
    const res = await ext.ingestAttachments('t1', [])
    expect(res).toEqual({ filesProcessed: 0, chunksInserted: 0, files: [] })
  })

  it('does nothing when disabled', async () => {
    ;(ext as any).config.enabled = false
    const res = await ext.ingestAttachments('t1', [{ path: '/a.txt' }])
    expect(res.filesProcessed).toBe(0)
  })

  it('throws when the vector DB extension is unavailable', async () => {
    extMgr().get.mockReturnValue({})
    await expect(
      ext.ingestAttachments('t1', [{ path: '/a.txt' }])
    ).rejects.toThrow('Vector DB extension not available')
  })

  it('enforces the file size limit', async () => {
    ;(ext as any).config.maxFileSizeMB = 1
    extMgr().get.mockReturnValue({
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
    extMgr().get.mockReturnValue({
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

  it('skips files without a path and files when ingestFile is missing', async () => {
    extMgr().get.mockReturnValue({
      createCollection: vi.fn(),
      insertChunks: vi.fn(),
    })
    const res = await ext.ingestAttachments('t1', [
      { path: '' } as any,
      { path: '/a.txt' },
    ])
    expect(res.filesProcessed).toBe(0)
  })
})

describe('ingestAttachmentsForProject', () => {
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('returns empty for missing project id or files', async () => {
    expect(await ext.ingestAttachmentsForProject('', [{ path: '/a' }])).toEqual({
      filesProcessed: 0,
      chunksInserted: 0,
      files: [],
    })
  })

  it('throws when project ingestion is unsupported', async () => {
    extMgr().get.mockReturnValue({})
    await expect(
      ext.ingestAttachmentsForProject('p1', [{ path: '/a.txt' }])
    ).rejects.toThrow('does not support project-level ingestion')
  })

  it('ingests project files', async () => {
    const ingestFileForProject = vi
      .fn()
      .mockResolvedValue({ file_id: 'f1', chunk_count: 4 })
    extMgr().get.mockReturnValue({ ingestFileForProject })
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
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('delegates parseDocument with a default mime type', async () => {
    ;(ragApi.parseDocument as any).mockResolvedValue('text')
    const out = await ext.parseDocument('/a.pdf')
    expect(out).toBe('text')
    expect(ragApi.parseDocument).toHaveBeenCalledWith(
      '/a.pdf',
      'application/octet-stream'
    )
  })

  it('passes an explicit mime type through', async () => {
    ;(ragApi.parseDocument as any).mockResolvedValue('t')
    await ext.parseDocument('/a.txt', 'text/plain')
    expect(ragApi.parseDocument).toHaveBeenCalledWith('/a.txt', 'text/plain')
  })

  it('embed returns [] for empty input without touching the engine', async () => {
    expect(await ext.embed([])).toEqual([])
    expect(extMgr().getByName).not.toHaveBeenCalled()
  })

  it('embed places vectors at their reported index', async () => {
    extMgr().getByName.mockReturnValue({
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
    extMgr().getByName.mockReturnValue(undefined)
    await expect(ext.embed(['a'])).rejects.toThrow('llamacpp extension not available')
  })
})

describe('onSettingUpdate', () => {
  let ext: RagExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = makeExt()
  })

  it('coerces and stores updated settings', () => {
    ext.onSettingUpdate('enabled', false)
    ext.onSettingUpdate('max_file_size_mb', '50')
    ext.onSettingUpdate('retrieval_limit', '9')
    ext.onSettingUpdate('search_mode', 'ann')
    ext.onSettingUpdate('parse_mode', 'embeddings')
    const cfg = (ext as any).config
    expect(cfg.enabled).toBe(false)
    expect(cfg.maxFileSizeMB).toBe(50)
    expect(cfg.retrievalLimit).toBe(9)
    expect(cfg.searchMode).toBe('ann')
    expect(cfg.parseMode).toBe('embeddings')
  })

  it('ignores unknown keys', () => {
    const before = { ...(ext as any).config }
    ext.onSettingUpdate('bogus', 123)
    expect((ext as any).config).toEqual(before)
  })
})

describe('configure', () => {
  it('registers settings and keeps defaults when getSetting echoes the default', async () => {
    vi.clearAllMocks()
    const ext = makeExt()
    await ext.configure()
    expect((ext as any).registerSettings).toHaveBeenCalledOnce()
    const cfg = (ext as any).config
    expect(cfg.retrievalLimit).toBe(3)
    expect(cfg.chunkSizeChars).toBe(512)
    expect(cfg.overlapChars).toBe(64)
  })
})
