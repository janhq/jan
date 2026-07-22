import { vi } from 'vitest'

// SETTINGS is injected at build time by rolldown's `define`; provide a stub here.
Object.defineProperty(globalThis, 'SETTINGS', {
  value: [],
  writable: true,
  configurable: true,
})

// window.core.extensionManager is the bridge RagExtension resolves dependencies through.
Object.defineProperty(globalThis, 'window', {
  value: {
    core: {
      extensionManager: {
        get: vi.fn(),
        getByName: vi.fn(),
      },
    },
  },
  writable: true,
  configurable: true,
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-rag-api', () => ({
  parseDocument: vi.fn(),
}))

vi.mock('@janhq/core', () => {
  class BaseExtension {
    registerSettings = vi.fn().mockResolvedValue(undefined)
    getSetting = vi.fn(async (_key: string, defaultValue: unknown) => defaultValue)
    getSettings = vi.fn().mockResolvedValue([])
  }
  class RAGExtension extends BaseExtension {}
  return {
    RAGExtension,
    BaseExtension,
    AIEngine: class {},
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
