import { vi } from 'vitest'

// SETTINGS is a build-time define (rolldown). Provide an empty list for tests.
;(globalThis as any).SETTINGS = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-local-engine-api', () => ({
  loadLocalModel: vi.fn(),
  unloadLocalModel: vi.fn(),
  getLocalLoadedModels: vi.fn().mockResolvedValue([]),
  checkLocalEngine: vi.fn().mockResolvedValue({ available: true }),
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
  getJanDataFolderPath: vi.fn().mockResolvedValue('/data'),
  fs: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    fileStat: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    mv: vi.fn(),
    copyFile: vi.fn(),
    writeFileSync: vi.fn(),
  },
  joinPath,
  AIEngine: AIEngineMock,
}))
