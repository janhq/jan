import { vi } from 'vitest'

// SETTINGS is a build-time define (rolldown). Provide an empty list for tests.
;(globalThis as any).SETTINGS = []

// Backed by a Map so the settings the engine persists can be read back.
const stored = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => stored.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => void stored.set(key, value)),
  removeItem: vi.fn((key: string) => void stored.delete(key)),
  clear: vi.fn(() => stored.clear()),
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStorageMock,
  },
  writable: true,
})

vi.mock('@janhq/tauri-plugin-mlx-api', () => ({
  loadMlxModel: vi.fn(),
  unloadMlxModel: vi.fn(),
  isMlxProcessRunning: vi.fn(),
  getMlxRandomPort: vi.fn(),
  findMlxSessionByModel: vi.fn(),
  getMlxLoadedModels: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  readGgufMetadata: vi.fn(),
}))

// join with '/' so path assertions are meaningful
const joinPath = vi.fn((parts: string[]) => parts.join('/'))

class AIEngineMock {
  getSetting = vi.fn(async (_key: string, def: unknown) => def)
}

vi.mock('@janhq/core', () => ({
  ServiceKeys: { Downloads: { id: 'downloads' }, Mlx: { id: 'mlx' } },
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
    readYaml: vi.fn(),
    writeYaml: vi.fn(),
    readFileSync: vi.fn(),
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
