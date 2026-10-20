import { vi } from 'vitest'

// `Promise.withResolvers` (Node 22+) is used by tests that resolve a promise
// from outside its executor. Polyfilled for the Node 20 runtime; a no-op where
// the runtime already ships it.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  (
    Promise as unknown as { withResolvers: <T>() => {
      promise: Promise<T>
      resolve: (value: T | PromiseLike<T>) => void
      reject: (reason?: unknown) => void
    } }
  ).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// Mock localStorage
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

// Mock the global window object for Tauri
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStorageMock,
    core: {
      api: {
        // getSystemInfo: vi.fn(),
      },
      extensionManager: {
        getByName: vi.fn().mockReturnValue({
          downloadFiles: vi.fn().mockResolvedValue(undefined),
          cancelDownload: vi.fn().mockResolvedValue(undefined),
        }),
      },
    },
  },
})

vi.mock('@janhq/tauri-plugin-hardware-api', () => ({
  getSystemInfo: vi.fn(),
}));

// Mock Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
  emit: vi.fn(),
}))

// Mock Tauri path API
vi.mock('@tauri-apps/api/path', () => ({
  basename: vi.fn(),
  dirname: vi.fn(),
  join: vi.fn(),
  resolve: vi.fn(),
}))

// Mock @janhq/core
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
  AppEvent: {
    onModelImported: 'onModelImported',
    onBackendVerificationFailed: 'onBackendVerificationFailed',
  },
  DownloadEvent: {
    onFileDownloadUpdate: 'onFileDownloadUpdate',
    onFileDownloadStopped: 'onFileDownloadStopped',
    onModelValidationStarted: 'onModelValidationStarted',
    onModelValidationFailed: 'onModelValidationFailed',
  },
  AIEngine: vi.fn(),
}))