import { vi } from 'vitest'

// SETTINGS is injected by the bundler at build time; source references it as a global.
Object.defineProperty(globalThis, 'SETTINGS', {
  value: [],
  writable: true,
})

vi.mock('@janhq/core', () => {
  class BaseExtension {
    registerSettings = vi.fn()
    getSetting = vi.fn().mockResolvedValue(undefined)
  }
  return {
    BaseExtension,
    downloads: {
      downloadFiles: vi.fn(),
      cancelDownload: vi.fn(),
      pauseDownload: vi.fn(),
      onDownloadProgress: vi.fn().mockResolvedValue(() => undefined),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    events: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
  }
})
