import { vi } from 'vitest'

// SETTINGS is injected at build time by rolldown's `define`; provide a stub here.
Object.defineProperty(globalThis, 'SETTINGS', {
  value: [],
  writable: true,
  configurable: true,
})

// window.core.extensionManager is the bridge RagExtension resolves dependencies
// through. `@janhq/core` reads `globalThis.core`, so both names must reach the
// same object -- in the browser they are the same object, and a setup that set
// only one made the core helpers silently see no extensions.
const core = {
  extensionManager: {
    get: vi.fn(),
    getByName: vi.fn(),
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { core },
  writable: true,
  configurable: true,
})

Object.defineProperty(globalThis, 'core', {
  value: core,
  writable: true,
  configurable: true,
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-rag-api', () => ({
  parseDocument: vi.fn(),
}))

// The embedding helpers are taken from the real module rather than stubbed:
// they are the shared implementation this extension delegates to, so stubbing
// them would leave the delegation untested on both sides.
vi.mock('@janhq/core', async () => {
  const actual = await vi.importActual<typeof import('@janhq/core')>('@janhq/core')
  class BaseExtension {
    registerSettings = vi.fn().mockResolvedValue(undefined)
    getSetting = vi.fn(async (_key: string, defaultValue: unknown) => defaultValue)
    getSettings = vi.fn().mockResolvedValue([])
  }
  class RAGExtension extends BaseExtension {}
  return {
    embedTexts: actual.embedTexts,
    getEmbeddingEngine: actual.getEmbeddingEngine,
    isEmbeddingEngine: actual.isEmbeddingEngine,
    RAGExtension,
    BaseExtension,
    RAG_INTERNAL_SERVER: 'rag-internal',
    ExtensionTypeEnum: {
      RAG: 'RAG',
      VectorDB: 'VectorDB',
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }
})
