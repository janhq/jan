import { vi } from 'vitest'

// SETTINGS is a build-time define (rolldown). Provide an empty list for tests.
;(globalThis as any).SETTINGS = []

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStorageMock,
    core: {
      extensionManager: {
        getByName: vi.fn().mockReturnValue({
          downloadFiles: vi.fn().mockResolvedValue(undefined),
          cancelDownload: vi.fn().mockResolvedValue(undefined),
          pauseDownload: vi.fn().mockResolvedValue(undefined),
        }),
      },
    },
  },
  writable: true,
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-mlx-api', () => ({
  loadMlxModel: vi.fn(),
  unloadMlxModel: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  readGgufMetadata: vi.fn(),
}))

// join with '/' so path assertions are meaningful
const joinPath = vi.fn((parts: string[]) => parts.join('/'))

class AIEngineMock {
  registerSettings = vi.fn()
  getSetting = vi.fn(async (_key: string, def: unknown) => def)
  onLoad = vi.fn()
}

vi.mock('@janhq/core', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getJanDataFolderPath: vi.fn(),
  fs: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    fileStat: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    mv: vi.fn(),
  },
  joinPath,
  events: {
    emit: vi.fn(),
  },
  AppEvent: {
    onModelImported: 'onModelImported',
  },
  DownloadEvent: {
    onFileDownloadUpdate: 'onFileDownloadUpdate',
    onFileDownloadStopped: 'onFileDownloadStopped',
    onFileDownloadError: 'onFileDownloadError',
    onFileDownloadAndVerificationSuccess: 'onFileDownloadAndVerificationSuccess',
  },
  AIEngine: AIEngineMock,
}))
