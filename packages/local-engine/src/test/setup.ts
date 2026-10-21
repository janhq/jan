import { vi } from 'vitest'

// SETTINGS is a build-time define (rolldown). Provide an empty list for tests.
;(globalThis as any).SETTINGS = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}))

export const loadLocalModel = vi.fn()
export const unloadLocalModel = vi.fn()
export const getLocalLoadedModels = vi.fn().mockResolvedValue([])
export const findLocalSessionByModel = vi.fn().mockResolvedValue(null)
export const checkLocalEngine = vi.fn().mockResolvedValue({ available: true })

vi.mock('@janhq/tauri-plugin-local-engine-api', () => ({
  loadLocalModel: (...args: unknown[]) => loadLocalModel(...args),
  unloadLocalModel: (...args: unknown[]) => unloadLocalModel(...args),
  getLocalLoadedModels: (...args: unknown[]) => getLocalLoadedModels(...args),
  findLocalSessionByModel: (...args: unknown[]) =>
    findLocalSessionByModel(...args),
  checkLocalEngine: (...args: unknown[]) => checkLocalEngine(...args),
}))

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
    existsSync: vi.fn().mockResolvedValue(false),
    readdirSync: vi.fn().mockResolvedValue([]),
    fileStat: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    mv: vi.fn(),
    copyFile: vi.fn(),
    writeFileSync: vi.fn(),
    readYaml: vi.fn().mockResolvedValue({
      name: 'my-model',
      model_path: '/models/my-model/model.bin',
      size_bytes: 1024,
    }),
    writeYaml: vi.fn(),
  },
  joinPath,
  events: { emit: vi.fn() },
  AppEvent: { onModelImported: 'onModelImported' },
  DownloadEvent: { onFileDownloadUpdate: 'onFileDownloadUpdate' },
  AIEngine: AIEngineMock,
}))
