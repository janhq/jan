import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// extends Vitest's expect method with methods from react-testing-library
expect.extend(matchers)

// Node 22+ ships an experimental global `localStorage` (webstorage) that is
// unusable here — it returns an object with no working setItem/clear — and it
// shadows jsdom's own localStorage. Provide a faithful in-memory Storage so
// every test that touches `localStorage` behaves like a browser.
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => void storageMap.clear(),
  getItem: (key: string) => (storageMap.has(key) ? storageMap.get(key)! : null),
  key: (index: number) => [...storageMap.keys()][index] ?? null,
  removeItem: (key: string) => void storageMap.delete(key),
  setItem: (key: string, value: string) => void storageMap.set(key, String(value)),
}
// Prefer jsdom's real Storage instance so `Storage.prototype.setItem`-style
// spies keep intercepting the methods tests rely on. Node 22+ shadows the
// global with an unusable webstorage object, so when that is what `window`
// exposes we fall back to the in-memory mock above.
const jsdomStorage = typeof window !== 'undefined' ? window.localStorage : undefined
const usable =
  jsdomStorage &&
  typeof (jsdomStorage as Storage).setItem === 'function' &&
  typeof (jsdomStorage as Storage).clear === 'function'
const chosen = usable ? (jsdomStorage as Storage) : localStorageMock
try {
  Object.defineProperty(globalThis, 'localStorage', {
    value: chosen,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, 'localStorage', {
    value: chosen,
    configurable: true,
    writable: true,
  })
} catch (error) {
  console.warn('Could not stub localStorage:', error)
}

// Create a mock ServiceHub
const mockServiceHub = {
  theme: () => ({
    getTheme: vi.fn().mockReturnValue('light'),
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
  window: vi.fn().mockReturnValue({
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    openLogsWindow: vi.fn().mockResolvedValue(undefined),
  }),
  events: () => ({
    emit: vi.fn().mockResolvedValue(undefined),
    listen: vi.fn().mockResolvedValue(() => {}),
  }),
  hardware: () => ({
    getHardwareInfo: vi.fn().mockResolvedValue(null),
    getSystemUsage: vi.fn().mockResolvedValue(null),
    getLlamacppDevices: vi.fn().mockResolvedValue([]), // cspell: disable-line
    setActiveGpus: vi.fn().mockResolvedValue(undefined),
    refreshHardwareInfo: vi.fn().mockResolvedValue(undefined),
    // Legacy methods for backward compatibility
    getGpuInfo: vi.fn().mockResolvedValue([]),
    getCpuInfo: vi.fn().mockResolvedValue({}),
    getMemoryInfo: vi.fn().mockResolvedValue({}),
  }),
  app: () => ({
    getAppSettings: vi.fn().mockResolvedValue({}),
    updateAppSettings: vi.fn().mockResolvedValue(undefined),
    getSystemInfo: vi.fn().mockResolvedValue({}),
    relocateJanDataFolder: vi.fn().mockResolvedValue(undefined),
    getJanDataFolder: vi.fn().mockResolvedValue('/mock/jan/data'),
  }),
  analytic: () => ({
    track: vi.fn(),
    identify: vi.fn(),
    page: vi.fn(),
  }),
  messages: () => ({
    createMessage: vi.fn().mockResolvedValue({ id: 'test-message' }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    updateMessage: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null),
    fetchMessages: vi.fn().mockResolvedValue([]),
  }),
  mcp: () => ({
    updateMCPConfig: vi.fn().mockResolvedValue(undefined),
    restartMCPServers: vi.fn().mockResolvedValue(undefined),
    getMCPConfig: vi.fn().mockResolvedValue({}),
    getTools: vi.fn().mockResolvedValue([]),
    getConnectedServers: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({ error: '', content: [] }),
    callToolWithCancellation: vi.fn().mockReturnValue({
      promise: Promise.resolve({ error: '', content: [] }),
      cancel: vi.fn().mockResolvedValue(undefined),
      token: 'test-token'
    }),
    cancelToolCall: vi.fn().mockResolvedValue(undefined),
    activateMCPServer: vi.fn().mockResolvedValue(undefined),
    deactivateMCPServer: vi.fn().mockResolvedValue(undefined),
  }),
  threads: () => ({
    createThread: vi.fn().mockResolvedValue({ id: 'test-thread', messages: [] }),
    deleteThread: vi.fn().mockResolvedValue(undefined),
    updateThread: vi.fn().mockResolvedValue(undefined),
    getThreads: vi.fn().mockResolvedValue([]),
    getThread: vi.fn().mockResolvedValue(null),
    fetchThreads: vi.fn().mockResolvedValue([]),
  }),
  providers: () => ({
    getProviders: vi.fn().mockResolvedValue([]),
    createProvider: vi.fn().mockResolvedValue({ id: 'test-provider' }),
    deleteProvider: vi.fn().mockResolvedValue(undefined),
    updateProvider: vi.fn().mockResolvedValue(undefined),
    getProvider: vi.fn().mockResolvedValue(null),
    fetchModelsFromProvider: vi.fn().mockResolvedValue([]),
  }),
  models: () => ({
    getModels: vi.fn().mockResolvedValue([]),
    getModel: vi.fn().mockResolvedValue(null),
    createModel: vi.fn().mockResolvedValue({ id: 'test-model' }),
    deleteModel: vi.fn().mockResolvedValue(undefined),
    updateModel: vi.fn().mockResolvedValue(undefined),
    startModel: vi.fn().mockResolvedValue(undefined),
    getActiveModels: vi.fn().mockResolvedValue([]),
    isModelSupported: vi.fn().mockResolvedValue('GREEN'),
    checkMmprojExists: vi.fn().mockResolvedValue(true), // cspell: disable-line
    stopAllModels: vi.fn().mockResolvedValue(undefined),
  }),
  assistants: () => ({
    getAssistants: vi.fn().mockResolvedValue([]),
    getAssistant: vi.fn().mockResolvedValue(null),
    createAssistant: vi.fn().mockResolvedValue({ id: 'test-assistant' }),
    deleteAssistant: vi.fn().mockResolvedValue(undefined),
    updateAssistant: vi.fn().mockResolvedValue(undefined),
  }),
  dialog: () => ({
    open: vi.fn().mockResolvedValue({ confirmed: true }),
    save: vi.fn().mockResolvedValue('/path/to/file'),
    message: vi.fn().mockResolvedValue(undefined),
  }),
  opener: vi.fn().mockReturnValue({
    open: vi.fn().mockResolvedValue(undefined),
    revealItemInDir: vi.fn().mockResolvedValue(undefined),
  }),
  updater: () => ({
    checkForUpdates: vi.fn().mockResolvedValue(null),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    downloadAndInstallWithProgress: vi.fn().mockResolvedValue(undefined),
  }),
  path: vi.fn().mockReturnValue({
    sep: () => '/',
    join: vi.fn((...args) => args.join('/')),
    resolve: vi.fn((path) => path),
    dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
    basename: vi.fn((path) => path.split('/').pop()),
  }),
  core: () => ({
    startCore: vi.fn().mockResolvedValue(undefined),
    stopCore: vi.fn().mockResolvedValue(undefined),
    getCoreStatus: vi.fn().mockResolvedValue('stopped'),
  }),
  deeplink: () => ({ // cspell: disable-line
    register: vi.fn().mockResolvedValue(undefined),
    handle: vi.fn().mockResolvedValue(undefined),
    getCurrent: vi.fn().mockResolvedValue(null),
    onOpenUrl: vi.fn().mockResolvedValue(undefined),
  }),
}

// Mock the useServiceHub module
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => mockServiceHub,
  getServiceHub: () => mockServiceHub,
  initializeServiceHubStore: vi.fn(),
  isServiceHubInitialized: () => true,
}))

// Mock window.matchMedia for useMediaQuery tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock globalThis.core.api for @janhq/core functions // cspell: disable-line
;(globalThis as Record<string, unknown>).core = {
  api: {
    getJanDataFolderPath: vi.fn().mockResolvedValue('/mock/jan/data'),
    openFileExplorer: vi.fn().mockResolvedValue(undefined),
    joinPath: vi.fn((...paths: string[]) => paths.join('/')),
  }
}

// Mock globalThis.fs for @janhq/core fs functions // cspell: disable-line
;(globalThis as Record<string, unknown>).fs = {
  existsSync: vi.fn().mockResolvedValue(false),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  rmdir: vi.fn().mockResolvedValue(undefined),
}


// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})
