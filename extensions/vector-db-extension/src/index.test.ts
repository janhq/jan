import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as vecdb from '@janhq/tauri-plugin-vector-db-api'
import * as ragApi from '@janhq/tauri-plugin-rag-api'
import VectorDBExt from './index'

const mockVecdb = vecdb as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockRag = ragApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const getByName = (window as any).core.extensionManager.getByName as ReturnType<typeof vi.fn>

function makeEngine(overrides: Record<string, unknown> = {}) {
  return {
    embed: vi.fn(),
    getEmbeddingContextSize: vi.fn(),
    countEmbeddingTokens: vi.fn(),
    ...overrides,
  }
}

let ext: VectorDBExt

beforeEach(() => {
  vi.clearAllMocks()
  getByName.mockReturnValue(undefined)
  mockVecdb.createCollection.mockResolvedValue(undefined)
  mockVecdb.insertChunks.mockResolvedValue(undefined)
  mockVecdb.deleteCollection.mockResolvedValue(undefined)
  mockVecdb.listAttachments.mockResolvedValue([])
  mockVecdb.chunkText.mockResolvedValue([])
  mockRag.parseDocument.mockResolvedValue('')
  ext = new VectorDBExt()
})

describe('lifecycle + passthrough', () => {
  it('onLoad/onUnload are no-ops', async () => {
    await expect(ext.onLoad()).resolves.toBeUndefined()
    expect(ext.onUnload()).toBeUndefined()
  })

  it('getStatus forwards the plugin result', async () => {
    mockVecdb.getStatus.mockResolvedValue({ available: true })
    await expect(ext.getStatus()).resolves.toEqual({ available: true })
  })
})

describe('collection naming', () => {
  it('prefixes thread and project collections distinctly', async () => {
    await ext.createCollection('t1', 384)
    await ext.createCollectionForProject('p1', 512)
    expect(mockVecdb.createCollection).toHaveBeenNthCalledWith(1, 'attachments_t1', 384)
    expect(mockVecdb.createCollection).toHaveBeenNthCalledWith(2, 'project_p1', 512)
  })

  it('routes search/insert/delete through the namespaced collection', async () => {
    await ext.insertChunks('t1', 'f1', [{ text: 'a', embedding: [1] }] as any)
    await ext.searchCollection('t1', [0.1], 5, 0.2, 'semantic' as any, ['f1'])
    await ext.deleteChunks('t1', ['c1'])
    await ext.deleteCollection('t1')
    expect(mockVecdb.insertChunks).toHaveBeenCalledWith('attachments_t1', 'f1', [{ text: 'a', embedding: [1] }])
    expect(mockVecdb.searchCollection).toHaveBeenCalledWith('attachments_t1', [0.1], 5, 0.2, 'semantic', ['f1'])
    expect(mockVecdb.deleteChunks).toHaveBeenCalledWith('attachments_t1', ['c1'])
    expect(mockVecdb.deleteCollection).toHaveBeenCalledWith('attachments_t1')
  })

  it('routes project variants through the project collection', async () => {
    await ext.insertChunksForProject('p1', 'f1', [] as any)
    await ext.searchCollectionForProject('p1', [0.5], 3, 0.1)
    await ext.getChunksForProject('p1', 'f1', 0, 10)
    await ext.deleteFileForProject('p1', 'f1')
    await ext.deleteCollectionForProject('p1')
    expect(mockVecdb.insertChunks).toHaveBeenCalledWith('project_p1', 'f1', [])
    expect(mockVecdb.searchCollection).toHaveBeenCalledWith('project_p1', [0.5], 3, 0.1, undefined, undefined)
    expect(mockVecdb.getChunks).toHaveBeenCalledWith('project_p1', 'f1', 0, 10)
    expect(mockVecdb.deleteFile).toHaveBeenCalledWith('project_p1', 'f1')
    expect(mockVecdb.deleteCollection).toHaveBeenCalledWith('project_p1')
  })
})

describe('embedTexts', () => {
  it('throws when no embedding engine is available', async () => {
    getByName.mockReturnValue(undefined)
    await expect((ext as any).embedTexts(['a'])).rejects.toThrow('llamacpp extension not available')
  })

  it('reorders embeddings by their reported index', async () => {
    getByName.mockReturnValue(
      makeEngine({
        embed: vi.fn().mockResolvedValue({
          data: [
            { embedding: [2], index: 1 },
            { embedding: [1], index: 0 },
          ],
        }),
      })
    )
    const out = await (ext as any).embedTexts(['a', 'b'])
    expect(out).toEqual([[1], [2]])
  })

  it('returns sparse array when embed omits data', async () => {
    getByName.mockReturnValue(makeEngine({ embed: vi.fn().mockResolvedValue({}) }))
    const out = await (ext as any).embedTexts(['a', 'b'])
    expect(out).toHaveLength(2)
    expect(out[0]).toBeUndefined()
  })
})

describe('chunk sizing against embedding context', () => {
  it('clampToEmbeddingContext returns original size when engine lacks ctx accessor', async () => {
    getByName.mockReturnValue(makeEngine({ getEmbeddingContextSize: undefined }))
    await expect((ext as any).clampToEmbeddingContext(4000, 100)).resolves.toBe(4000)
  })

  it('clampToEmbeddingContext falls back to original size when ctx size is unavailable', async () => {
    getByName.mockReturnValue(makeEngine({ getEmbeddingContextSize: vi.fn().mockResolvedValue(0) }))
    await expect((ext as any).clampToEmbeddingContext(4000, 100)).resolves.toBe(4000)
  })

  it('clampToEmbeddingContext narrows the budget from the model ctx', async () => {
    // ctx 512 -> 512*3*0.8 = 1228 - 100 overlap = 1128 < 4000
    getByName.mockReturnValue(makeEngine({ getEmbeddingContextSize: vi.fn().mockResolvedValue(512) }))
    await expect((ext as any).clampToEmbeddingContext(4000, 100)).resolves.toBe(1128)
  })

  it('clampToEmbeddingContext never drops below the minimum chunk size', async () => {
    getByName.mockReturnValue(makeEngine({ getEmbeddingContextSize: vi.fn().mockResolvedValue(1) }))
    await expect((ext as any).clampToEmbeddingContext(4000, 5000)).resolves.toBe(64)
  })

  it('ensureChunksFitEmbeddingContext passes chunks through without a token counter', async () => {
    getByName.mockReturnValue(makeEngine({ countEmbeddingTokens: undefined }))
    const chunks = ['x', 'y']
    await expect((ext as any).ensureChunksFitEmbeddingContext(chunks)).resolves.toBe(chunks)
  })

  it('splitChunkToFit keeps a chunk that fits the token budget', async () => {
    const llm = { countEmbeddingTokens: vi.fn().mockResolvedValue([10]) }
    await expect((ext as any).splitChunkToFit('short text', 100, llm)).resolves.toEqual(['short text'])
  })

  it('splitChunkToFit recursively halves an oversized chunk', async () => {
    const big = 'a'.repeat(200)
    const llm = {
      countEmbeddingTokens: vi.fn().mockImplementation((texts: string[]) =>
        Promise.resolve([texts[0].length])
      ),
    }
    const out = await (ext as any).splitChunkToFit(big, 80, llm)
    expect(out.length).toBeGreaterThan(1)
    expect(out.join('')).toBe(big)
    out.forEach((c: string) => expect(c.length).toBeLessThanOrEqual(80))
  })

  it('splitChunkToFit stops halving at the minimum chunk size even if over budget', async () => {
    const text = 'a'.repeat(50)
    const llm = { countEmbeddingTokens: vi.fn().mockResolvedValue([999]) }
    await expect((ext as any).splitChunkToFit(text, 1, llm)).resolves.toEqual([text])
  })

  it('splitChunkToFit drops empty input', async () => {
    const llm = { countEmbeddingTokens: vi.fn() }
    await expect((ext as any).splitChunkToFit('', 10, llm)).resolves.toEqual([])
    expect(llm.countEmbeddingTokens).not.toHaveBeenCalled()
  })

  it('clampToEmbeddingContext propagates a failing ctx-size probe', async () => {
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: vi
          .fn()
          .mockRejectedValue(new Error('router down')),
      })
    )
    await expect((ext as any).clampToEmbeddingContext(4000, 100)).rejects.toThrow(
      /embedding context size.*router down/i
    )
  })

  it('ensureChunksFitEmbeddingContext propagates a failing ctx-size probe', async () => {
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: vi
          .fn()
          .mockRejectedValue(new Error('model failed to load')),
      })
    )
    await expect(
      (ext as any).ensureChunksFitEmbeddingContext(['x'])
    ).rejects.toThrow(/embedding context size.*model failed to load/i)
  })

  it('splitChunkToFit propagates a failing token count instead of passing oversized chunks', async () => {
    const llm = {
      countEmbeddingTokens: vi.fn().mockRejectedValue(new Error('tokenize 500')),
    }
    await expect((ext as any).splitChunkToFit('text', 10, llm)).rejects.toThrow(
      /count embedding tokens.*tokenize 500/i
    )
  })
})

describe('ingestFile (thread)', () => {
  it('rejects a duplicate name+path attachment', async () => {
    mockVecdb.listAttachments.mockResolvedValue([{ name: 'doc.txt', path: '/d/doc.txt' }])
    await expect(
      ext.ingestFile('t1', { name: 'doc.txt', path: '/d/doc.txt', type: 'text/plain' } as any, {
        chunkSize: 100,
        chunkOverlap: 10,
      } as any)
    ).rejects.toThrow('already been attached to this thread')
  })

  it('creates only a file record when the document yields no chunks', async () => {
    mockRag.parseDocument.mockResolvedValue('')
    mockVecdb.chunkText.mockResolvedValue([])
    mockVecdb.createFile.mockResolvedValue({ id: 'f1' })
    const res = await ext.ingestFile('t1', { name: 'a', path: '/a', type: 'text/plain' } as any, {
      chunkSize: 100,
      chunkOverlap: 10,
    } as any)
    expect(res).toEqual({ id: 'f1' })
    expect(mockVecdb.insertChunks).not.toHaveBeenCalled()
    expect(mockVecdb.createCollection).not.toHaveBeenCalled()
  })

  it('throws when embeddings have no dimension', async () => {
    mockRag.parseDocument.mockResolvedValue('body')
    mockVecdb.chunkText.mockResolvedValue(['body'])
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: undefined,
        countEmbeddingTokens: undefined,
        embed: vi.fn().mockResolvedValue({ data: [{ embedding: [], index: 0 }] }),
      })
    )
    await expect(
      ext.ingestFile('t1', { name: 'a', path: '/a', type: 'text/plain' } as any, {
        chunkSize: 100,
        chunkOverlap: 10,
      } as any)
    ).rejects.toThrow('Embedding dimension not available')
  })

  it('embeds, creates collection with the embedding dimension, inserts chunks, returns updated info', async () => {
    mockRag.parseDocument.mockResolvedValue('body')
    mockVecdb.chunkText.mockResolvedValue(['c1', 'c2'])
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: undefined,
        countEmbeddingTokens: undefined,
        embed: vi.fn().mockResolvedValue({
          data: [
            { embedding: [0.1, 0.2, 0.3], index: 0 },
            { embedding: [0.4, 0.5, 0.6], index: 1 },
          ],
        }),
      })
    )
    mockVecdb.createFile.mockResolvedValue({ id: 'f1' })
    mockVecdb.listAttachments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'f1', name: 'a', chunk_count: 2 }])

    const res = await ext.ingestFile('t1', { name: 'a', path: '/a', type: 'text/plain' } as any, {
      chunkSize: 100,
      chunkOverlap: 10,
    } as any)

    expect(mockVecdb.createCollection).toHaveBeenCalledWith('attachments_t1', 3)
    expect(mockVecdb.insertChunks).toHaveBeenCalledWith('attachments_t1', 'f1', [
      { text: 'c1', embedding: [0.1, 0.2, 0.3] },
      { text: 'c2', embedding: [0.4, 0.5, 0.6] },
    ])
    expect(res).toEqual({ id: 'f1', name: 'a', chunk_count: 2 })
  })

  it('falls back to synthesized info when the updated attachment is not listed', async () => {
    mockRag.parseDocument.mockResolvedValue('body')
    mockVecdb.chunkText.mockResolvedValue(['c1'])
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: undefined,
        countEmbeddingTokens: undefined,
        embed: vi.fn().mockResolvedValue({ data: [{ embedding: [1, 2], index: 0 }] }),
      })
    )
    mockVecdb.createFile.mockResolvedValue({ id: 'f1', name: 'a' })
    mockVecdb.listAttachments.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await ext.ingestFile('t1', { name: 'a', path: '/a', type: 'text/plain' } as any, {
      chunkSize: 100,
      chunkOverlap: 10,
    } as any)
    expect(res).toEqual({ id: 'f1', name: 'a', chunk_count: 1 })
  })
})

describe('ingestFileForProject', () => {
  it('creates the collection before the duplicate check and rejects duplicates', async () => {
    mockRag.parseDocument.mockResolvedValue('body')
    mockVecdb.chunkText.mockResolvedValue(['c1'])
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: undefined,
        countEmbeddingTokens: undefined,
        embed: vi.fn().mockResolvedValue({ data: [{ embedding: [1, 2], index: 0 }] }),
      })
    )
    mockVecdb.listAttachments.mockResolvedValue([{ name: 'a', path: '/a' }])
    await expect(
      ext.ingestFileForProject('p1', { name: 'a', path: '/a', type: 'text/plain' } as any, {
        chunkSize: 100,
        chunkOverlap: 10,
      } as any)
    ).rejects.toThrow('already been attached to this project')
    expect(mockVecdb.createCollection).toHaveBeenCalledWith('project_p1', 2)
  })

  it('uses the default 384 dimension when there are no chunks', async () => {
    mockRag.parseDocument.mockResolvedValue('')
    mockVecdb.chunkText.mockResolvedValue([])
    mockVecdb.listAttachments.mockResolvedValue([])
    mockVecdb.createFile.mockResolvedValue({ id: 'f1' })
    const res = await ext.ingestFileForProject('p1', { name: 'a', path: '/a' } as any, {
      chunkSize: 100,
      chunkOverlap: 10,
    } as any)
    expect(mockVecdb.createCollection).toHaveBeenCalledWith('project_p1', 384)
    expect(res).toEqual({ id: 'f1' })
    expect(mockVecdb.insertChunks).not.toHaveBeenCalled()
  })

  it('recreates the collection when the final embedding dimension differs from the seed', async () => {
    mockRag.parseDocument.mockResolvedValue('body')
    mockVecdb.chunkText.mockResolvedValue(['c1'])
    let call = 0
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: undefined,
        countEmbeddingTokens: undefined,
        embed: vi.fn().mockImplementation(() => {
          call += 1
          // First embed (dimension probe) -> len 2; re-embed -> len 3
          return Promise.resolve({
            data: [{ embedding: call === 1 ? [1, 2] : [1, 2, 3], index: 0 }],
          })
        }),
      })
    )
    mockVecdb.createFile.mockResolvedValue({ id: 'f1' })
    mockVecdb.listAttachments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'f1', chunk_count: 1 }])

    await ext.ingestFileForProject('p1', { name: 'a', path: '/a' } as any, {
      chunkSize: 100,
      chunkOverlap: 10,
    } as any)

    expect(mockVecdb.createCollection).toHaveBeenNthCalledWith(1, 'project_p1', 2)
    expect(mockVecdb.deleteCollection).toHaveBeenCalledWith('project_p1')
    expect(mockVecdb.createCollection).toHaveBeenNthCalledWith(2, 'project_p1', 3)
  })

  it('throws when the re-embed yields no dimension', async () => {
    mockRag.parseDocument.mockResolvedValue('body')
    mockVecdb.chunkText.mockResolvedValue(['c1'])
    let call = 0
    getByName.mockReturnValue(
      makeEngine({
        getEmbeddingContextSize: undefined,
        countEmbeddingTokens: undefined,
        embed: vi.fn().mockImplementation(() => {
          call += 1
          return Promise.resolve({
            data: [{ embedding: call === 1 ? [1, 2] : [], index: 0 }],
          })
        }),
      })
    )
    mockVecdb.listAttachments.mockResolvedValue([])
    await expect(
      ext.ingestFileForProject('p1', { name: 'a', path: '/a' } as any, {
        chunkSize: 100,
        chunkOverlap: 10,
      } as any)
    ).rejects.toThrow('Embedding dimension not available')
  })
})
