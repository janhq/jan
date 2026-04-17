import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all heavy dependencies before importing DataProvider
const mockSetProviders = vi.fn()
const mockGetProviderByName = vi.fn()
const mockCheckForUpdate = vi.fn()
const mockSetServers = vi.fn()
const mockSetSettings = vi.fn()
const mockSetAssistants = vi.fn()
const mockSetThreads = vi.fn()
const mockNavigate = vi.fn()
const mockSetServerStatus = vi.fn()

const mockGetProviders = vi.fn().mockResolvedValue([])
const mockGetMCPConfig = vi.fn().mockResolvedValue({ mcpServers: {}, mcpSettings: {} })
const mockGetAssistants = vi.fn().mockResolvedValue([])
const mockGetCurrent = vi.fn().mockResolvedValue(null)
const mockOnOpenUrl = vi.fn().mockResolvedValue(() => {})
const mockListen = vi.fn().mockResolvedValue(() => {})
const mockFetchThreads = vi.fn().mockResolvedValue([])
const mockGetServerStatus = vi.fn().mockResolvedValue(false)

vi.mock('@/hooks/useModelProvider', () => {
  const fn = vi.fn(() => ({
    setProviders: mockSetProviders,
    getProviderByName: mockGetProviderByName,
  }))
  fn.getState = vi.fn(() => ({ providers: [] }))
  return { useModelProvider: fn }
})

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: vi.fn(() => ({ checkForUpdate: mockCheckForUpdate })),
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: vi.fn(() => ({ setServers: mockSetServers, setSettings: mockSetSettings })),
  DEFAULT_MCP_SETTINGS: {},
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: vi.fn(() => ({ setAssistants: mockSetAssistants })),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => mockNavigate),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({ setThreads: mockSetThreads })),
}))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: vi.fn(() => ({
    enableOnStartup: false,
    serverHost: '127.0.0.1',
    serverPort: 1337,
    setServerPort: vi.fn(),
    apiPrefix: '/v1',
    apiKey: '',
    trustedHosts: [],
    corsEnabled: false,
    verboseLogs: false,
    proxyTimeout: 30000,
    lastServerModels: [],
    setLastServerModels: vi.fn(),
    defaultModelLocalApiServer: null,
  })),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn((selector: any) => {
    if (selector) return selector({ setServerStatus: mockSetServerStatus })
    return { setServerStatus: mockSetServerStatus }
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    providers: () => ({ getProviders: mockGetProviders }),
    mcp: () => ({ getMCPConfig: mockGetMCPConfig }),
    assistants: () => ({ getAssistants: mockGetAssistants }),
    deeplink: () => ({ getCurrent: mockGetCurrent, onOpenUrl: mockOnOpenUrl }),
    events: () => ({ listen: mockListen }),
    threads: () => ({ fetchThreads: mockFetchThreads }),
    app: () => ({ getServerStatus: mockGetServerStatus }),
    models: () => ({ startModel: vi.fn(), getActiveModels: vi.fn() }),
    analytic: () => ({ getAppDistinctId: vi.fn(), updateDistinctId: vi.fn() }),
  })),
}))

vi.mock('@janhq/core', () => ({
  AppEvent: { onModelImported: 'onModelImported' },
  events: { on: vi.fn(), off: vi.fn() },
}))

vi.mock('@/constants/routes', () => ({
  route: { home: '/', hub: { model: '/hub/model' }, settings: { general: '/settings' } },
}))

vi.mock('@/lib/utils', () => ({ isDev: vi.fn(() => true) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/lib/provider-api-keys', () => ({
  providerHasRemoteApiKeys: vi.fn(() => false),
  providerRemoteApiKeyChain: vi.fn(() => []),
}))

import { DataProvider } from '../DataProvider'

describe('DataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviders.mockResolvedValue([])
    mockGetMCPConfig.mockResolvedValue({ mcpServers: {}, mcpSettings: {} })
    mockGetAssistants.mockResolvedValue([])
    mockGetCurrent.mockResolvedValue(null)
    mockFetchThreads.mockResolvedValue([])
  })

  it('renders null', async () => {
    const { container } = render(<DataProvider />)
    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })
    expect(container.innerHTML).toBe('')
  })

  it('loads providers on mount', async () => {
    const providers = [{ provider: 'openai', active: false, models: [] }]
    mockGetProviders.mockResolvedValue(providers)
    render(<DataProvider />)
    await waitFor(() => {
      expect(mockSetProviders).toHaveBeenCalledWith(providers)
    })
  })

  it('loads MCP config on mount', async () => {
    mockGetMCPConfig.mockResolvedValue({
      mcpServers: { s1: {} },
      mcpSettings: { timeout: 30 },
    })
    render(<DataProvider />)
    await waitFor(() => {
      expect(mockSetServers).toHaveBeenCalledWith({ s1: {} })
      expect(mockSetSettings).toHaveBeenCalledWith({ timeout: 30 })
    })
  })

  it('loads assistants on mount', async () => {
    const assistants = [{ id: 'a1' }]
    mockGetAssistants.mockResolvedValue(assistants)
    render(<DataProvider />)
    await waitFor(() => {
      expect(mockSetAssistants).toHaveBeenCalledWith(assistants)
    })
  })

  it('sets assistants to null when empty', async () => {
    mockGetAssistants.mockResolvedValue([])
    render(<DataProvider />)
    await waitFor(() => {
      expect(mockSetAssistants).toHaveBeenCalledWith(null)
    })
  })

  it('fetches threads on mount', async () => {
    const threads = [{ id: 't1' }]
    mockFetchThreads.mockResolvedValue(threads)
    render(<DataProvider />)
    await waitFor(() => {
      expect(mockSetThreads).toHaveBeenCalledWith(threads)
    })
  })

  it('handles deeplink with valid URL', async () => {
    mockGetCurrent.mockResolvedValue(['jan://open/provider/org/model-name'])
    render(<DataProvider />)
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/hub/model',
        search: { repo: 'org/model-name' },
      })
    })
  })

  it('ignores null deeplink', async () => {
    mockGetCurrent.mockResolvedValue(null)
    render(<DataProvider />)
    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
    })
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
