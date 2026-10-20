import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getEmbeddingEngine, embedTexts, EMBEDDING_ENGINE_EXTENSION } from './embedding'

function withExtension(ext: unknown) {
  globalThis.core = { extensionManager: { getByName: vi.fn().mockReturnValue(ext) } }
}

const engine = {
  embed: vi.fn(),
  getEmbeddingContextSize: vi.fn(),
  countEmbeddingTokens: vi.fn(),
}

describe('getEmbeddingEngine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('looks the engine up by extension name', () => {
    withExtension(engine)
    expect(getEmbeddingEngine()).toBe(engine)
    expect(globalThis.core.extensionManager.getByName).toHaveBeenCalledWith(
      EMBEDDING_ENGINE_EXTENSION
    )
  })

  it('returns undefined when the extension is absent', () => {
    withExtension(undefined)
    expect(getEmbeddingEngine()).toBeUndefined()
  })

  it('returns undefined when the extension cannot embed', () => {
    withExtension({ embed: () => {} })
    expect(getEmbeddingEngine()).toBeUndefined()
  })

  // Producing a vector needs no tokenizer, so embedTexts must accept an engine
  // that getEmbeddingEngine rejects for lacking the token-counting queries.
  it('is stricter than embedTexts about the tokenizer queries', async () => {
    withExtension({ embed: vi.fn().mockResolvedValue({ data: [{ embedding: [7], index: 0 }] }) })
    expect(getEmbeddingEngine()).toBeUndefined()
    await expect(embedTexts(['a'])).resolves.toEqual([[7]])
  })

  it('survives a missing extension manager', () => {
    globalThis.core = undefined
    expect(getEmbeddingEngine()).toBeUndefined()
  })
})

describe('embedTexts', () => {
  beforeEach(() => vi.clearAllMocks())

  // The response is keyed by `index`, so a provider returning them out of
  // order must not shift every vector onto the wrong text.
  it('scatters vectors back by index, not by response order', async () => {
    withExtension(engine)
    engine.embed.mockResolvedValue({
      data: [
        { embedding: [3], index: 2 },
        { embedding: [1], index: 0 },
        { embedding: [2], index: 1 },
      ],
    })
    await expect(embedTexts(['a', 'b', 'c'])).resolves.toEqual([[1], [2], [3]])
  })

  it('short-circuits on an empty input without touching the engine', async () => {
    withExtension(engine)
    await expect(embedTexts([])).resolves.toEqual([])
    expect(engine.embed).not.toHaveBeenCalled()
  })

  it('throws when no embedding engine is available', async () => {
    withExtension(undefined)
    await expect(embedTexts(['a'])).rejects.toThrow('llamacpp extension not available')
  })

  it('tolerates a response with no data', async () => {
    withExtension(engine)
    engine.embed.mockResolvedValue({})
    await expect(embedTexts(['a'])).resolves.toEqual([undefined])
  })
})
