import { expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// extends Vitest's expect method with methods from react-testing-library
expect.extend(matchers)

// Create a mock ServiceHub
const mockServiceHub = {
  theme: () => ({
    getTheme: vi.fn().mockReturnValue('light'),
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
  window: () => ({
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
  }),
  events: () => ({
    emit: vi.fn().mockResolvedValue(undefined),
    listen: vi.fn().mockResolvedValue(() => {}),
  }),
  hardware: () => ({
    getHardwareInfo: vi.fn().mockResolvedValue(null),
    getSystemUsage: vi.fn().mockResolvedValue(null),
    getLlamacppDevices: vi.fn().mockResolvedValue([]),
    setActiveGpus: vi.fn().mockResolvedValue(undefined),
    // Legacy methods for backward compatibility
    getGpuInfo: vi.fn().mockResolvedValue([]),
    getCpuInfo: vi.fn().mockResolvedValue({}),
    getMemoryInfo: vi.fn().mockResolvedValue({}),
  }),
  app: () => ({
    getAppSettings: vi.fn().mockResolvedValue({}),
    updateAppSettings: vi.fn().mockResolvedValue(undefined),
    getSystemInfo: vi.fn().mockResolvedValue({}),
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
  }),
  models: () => ({
    getModels: vi.fn().mockResolvedValue([]),
    getModel: vi.fn().mockResolvedValue(null),
    createModel: vi.fn().mockResolvedValue({ id: 'test-model' }),
    deleteModel: vi.fn().mockResolvedValue(undefined),
    updateModel: vi.fn().mockResolvedValue(undefined),
    startModel: vi.fn().mockResolvedValue(undefined),
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
  opener: () => ({
    open: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(undefined),
  }),
  updater: () => ({
    checkForUpdates: vi.fn().mockResolvedValue(null),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    downloadAndInstallWithProgress: vi.fn().mockResolvedValue(undefined),
  }),
  path: () => ({
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
  deeplink: () => ({
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

// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
})