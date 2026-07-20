import { vi } from 'vitest'

vi.mock('@janhq/tauri-plugin-vector-db-api', () => ({
  getStatus: vi.fn(),
  createCollection: vi.fn().mockResolvedValue(undefined),
  insertChunks: vi.fn().mockResolvedValue(undefined),
  searchCollection: vi.fn().mockResolvedValue([]),
  deleteChunks: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
  createFile: vi.fn(),
  listAttachments: vi.fn().mockResolvedValue([]),
  getChunks: vi.fn().mockResolvedValue([]),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  chunkText: vi.fn().mockResolvedValue([]),
}))

vi.mock('@janhq/tauri-plugin-rag-api', () => ({
  parseDocument: vi.fn().mockResolvedValue(''),
}))

vi.mock('@janhq/core', () => ({
  VectorDBExtension: class {},
  AIEngine: class {},
}))

const getByName = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: {
    core: {
      extensionManager: { getByName },
    },
  },
  writable: true,
  configurable: true,
})
