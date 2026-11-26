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

// The embedding helpers run for real against this engine registry: they are
// the shared implementation this extension delegates to, so stubbing them
// would leave the delegation untested on both sides.
window.core = { engineManager: { get: vi.fn() } }
