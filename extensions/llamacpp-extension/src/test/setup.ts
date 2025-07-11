import { vi } from 'vitest'

// Mock the global window object for Tauri
Object.defineProperty(globalThis, 'window', {
  value: {
    core: {
      api: {
        getSystemInfo: vi.fn(),
      },
      extensionManager: {
        getByName: vi.fn(),
      },
    },
  },
})

// Mock Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock @janhq/core
vi.mock('@janhq/core', () => ({
  getJanDataFolderPath: vi.fn(),
  fs: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    fileStat: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
  joinPath: vi.fn(),
  modelInfo: {},
  SessionInfo: {},
  UnloadResult: {},
  chatCompletion: {},
  chatCompletionChunk: {},
  ImportOptions: {},
  chatCompletionRequest: {},
  events: {
    emit: vi.fn(),
  },
  AIEngine: vi.fn(),
}))