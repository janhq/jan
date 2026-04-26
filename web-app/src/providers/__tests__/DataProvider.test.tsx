import { render, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub the build-time define used by DataProvider
;(globalThis as unknown as { UPDATE_CHECK_INTERVAL_MS: number }).UPDATE_CHECK_INTERVAL_MS = 60_000

// Hoisted shared mocks/state
const h = vi.hoisted(() => {
  return {
    setProviders: vi.fn(),
    getProviderByName: vi.fn(),
    providers: [] as Array<Record<string, unknown>>,
    checkForUpdate: vi.fn(),
    setServers: vi.fn(),
    setSettings: vi.fn(),
    setAssistants: vi.fn(),
    setThreads: vi.fn(),
    setLastServerModels: vi.fn(),
    setServerPort: vi.fn(),
    setServerStatus: vi.fn(),
    navigate: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined),
    isDev: vi.fn().mockReturnValue(false),
    providerHasRemoteApiKeys: vi.fn().mockReturnValue(true),
    providerRemoteApiKeyChain: vi.fn().mockReturnValue(['key-1']),
    eventsOn: vi.fn(),
    localApi: {
      enableOnStartup: false,
      serverHost: '127.0.0.1',
      serverPort: 1337,
      apiPrefix: '/v1',
      apiKey: '',
      trustedHosts: [],
      corsEnabled: true,
      verboseLogs: false,
      proxyTimeout: 0,
      lastServerModels: [] as Array<{ model: string; provider: string }>,
      defaultModelLocalApiServer: null as null | { model: string; provider: string },
    },
  }
})

// Zustand-style hook with getState support
vi.mock('@/hooks/useModelProvider', () => {
  const useModelProvider = vi.fn(() => ({
    setProviders: h.setProviders,
    getProviderByName: h.getProviderByName,
  })) as unknown as { (): unknown; getState: () => { providers: unknown[] } }
  useModelProvider.getState = () => ({ providers: h.providers })
  return { useModelProvider }
})

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({ checkForUpdate: h.checkForUpdate }),
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: () => ({ setServers: h.setServers, setSettings: h.setSettings }),
  DEFAULT_MCP_SETTINGS: { foo: 'bar' },
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({ setAssistants: h.setAssistants }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: () => ({ setThreads: h.setThreads }),
}))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    ...h.localApi,
    setLastServerModels: h.setLastServerModels,
    setServerPort: h.setServerPort,
  }),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (sel: (s: { setServerStatus: unknown }) => unknown) =>
    sel({ setServerStatus: h.setServerStatus }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
}))

vi.mock('@/lib/utils', () => ({
  isDev: () => h.isDev(),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerHasRemoteApiKeys: (p: unknown) => h.providerHasRemoteApiKeys(p),
  providerRemoteApiKeyChain: (p: unknown) => h.providerRemoteApiKeyChain(p),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => h.invoke(...args),
}))

vi.mock('@janhq/core', () => ({
  AppEvent: { onModelImported: 'onModelImported' },
  events: { on: (...a: unknown[]) => h.eventsOn(...a) },
}))

vi.mock('@/types/events', () => ({
  SystemEvent: { DEEP_LINK: 'deep-link' },
}))

vi.mock('@/constants/routes', () => ({
  route: { hub: { model: '/hub/model' } },
}))

// Override serviceHub per-test needs. We extend the global setup's mock.
const hubState = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  deeplinkGetCurrent: vi.fn().mockResolvedValue(null),
  deeplinkOnOpenUrl: vi.fn().mockResolvedValue(undefined),
  eventsListen: vi.fn(),
  getProviders: vi.fn().mockResolvedValue([]),
  getMCPConfig: vi.fn().mockResolvedValue({ mcpServers: { a: 1 }, mcpSettings: { s: 1 } }),
  getAssistants: vi.fn().mockResolvedValue([]),
  fetchThreads: vi.fn().mockResolvedValue([]),
  getServerStatus: vi.fn().mockResolvedValue(false),
  startModel: vi.fn().mockResolvedValue(undefined),
  getActiveModels: vi.fn().mockResolvedValue([]),
  startServer: vi.fn().mockResolvedValue(1337),
}))

vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    providers: () => ({ getProviders: hubState.getProviders }),
    mcp: () => ({ getMCPConfig: hubState.getMCPConfig }),
    assistants: () => ({ getAssistants: hubState.getAssistants }),
    threads: () => ({ fetchThreads: hubState.fetchThreads }),
    deeplink: () => ({
      getCurrent: hubState.deeplinkGetCurrent,
      onOpenUrl: hubState.deeplinkOnOpenUrl,
    }),
    events: () => ({
      listen: (...args: unknown[]) => {
        hubState.eventsListen(...args)
        return Promise.resolve(hubState.unsubscribe)
      },
    }),
    app: () => ({ getServerStatus: hubState.getServerStatus }),
    models: () => ({
      startModel: hubState.startModel,
      getActiveModels: hubState.getActiveModels,
    }),
  }
  return {
    useServiceHub: () => hub,
    getServiceHub: () => hub,
    initializeServiceHubStore: vi.fn(),
    isServiceHubInitialized: () => true,
  }
})

// Import after mocks
import { DataProvider } from '../DataProvider'

const resetHubState = () => {
  hubState.getProviders.mockResolvedValue([])
  hubState.getMCPConfig.mockResolvedValue({ mcpServers: { a: 1 }, mcpSettings: { s: 1 } })
  hubState.getAssistants.mockResolvedValue([])
  hubState.fetchThreads.mockResolvedValue([])
  hubState.getServerStatus.mockResolvedValue(false)
  hubState.getActiveModels.mockResolvedValue([])
  hubState.startServer.mockResolvedValue(1337)
  hubState.startModel.mockResolvedValue(undefined)
  hubState.deeplinkGetCurrent.mockResolvedValue(null)
}

describe('DataProvider', () => {
  const originalWindowCore = (window as unknown as { core?: unknown }).core

  beforeEach(() => {
    resetHubState()
    h.providers = []
    h.isDev.mockReturnValue(false)
    h.providerHasRemoteApiKeys.mockReturnValue(true)
    h.providerRemoteApiKeyChain.mockReturnValue(['key-1'])
    h.invoke.mockResolvedValue(undefined)
    h.localApi.enableOnStartup = false
    h.localApi.defaultModelLocalApiServer = null
    h.localApi.lastServerModels = []
    ;(window as unknown as { core: unknown }).core = {
      api: { startServer: hubState.startServer },
    }
  })

  afterEach(() => {
    ;(window as unknown as { core?: unknown }).core = originalWindowCore
  })

  it('renders null (no DOM output)', () => {
    const { container } = render(<DataProvider />)
    expect(container.firstChild).toBeNull()
  })

  it('hydrates providers, mcp config, assistants, threads on mount', async () => {
    hubState.getProviders.mockResolvedValue([
      { provider: 'openai', active: true, models: [{ id: 'gpt' }], custom_header: [] },
    ])
    hubState.getAssistants.mockResolvedValue([{ id: 'a1' }])
    hubState.fetchThreads.mockResolvedValue([{ id: 't1' }])

    render(<DataProvider />)

    await waitFor(() => {
      expect(hubState.getProviders).toHaveBeenCalled()
      expect(hubState.getMCPConfig).toHaveBeenCalled()
      expect(hubState.getAssistants).toHaveBeenCalled()
      expect(hubState.fetchThreads).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(h.setProviders).toHaveBeenCalledWith([
        expect.objectContaining({ provider: 'openai' }),
      ])
      expect(h.setServers).toHaveBeenCalledWith({ a: 1 })
      expect(h.setSettings).toHaveBeenCalledWith({ s: 1 })
      expect(h.setAssistants).toHaveBeenCalledWith([{ id: 'a1' }])
      expect(h.setThreads).toHaveBeenCalledWith([{ id: 't1' }])
    })
  })

  it('passes DEFAULT_MCP_SETTINGS when mcp config lacks values', async () => {
    hubState.getMCPConfig.mockResolvedValue({})
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.setServers).toHaveBeenCalledWith({})
      expect(h.setSettings).toHaveBeenCalledWith({ foo: 'bar' })
    })
  })

  it('sets assistants to null when service returns empty array', async () => {
    hubState.getAssistants.mockResolvedValue([])
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.setAssistants).toHaveBeenCalledWith(null)
    })
  })

  it('handles assistants service rejection without crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    hubState.getAssistants.mockRejectedValue(new Error('boom'))
    render(<DataProvider />)
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'Failed to load assistants, keeping default:',
        expect.any(Error),
      )
    })
    warn.mockRestore()
  })

  it('subscribes to deep link system events and cleans up on unmount', async () => {
    const { unmount } = render(<DataProvider />)
    await waitFor(() => {
      expect(hubState.eventsListen).toHaveBeenCalledWith('deep-link', expect.any(Function))
    })
    // Let the listen().then(unsub => unsubscribe = unsub) resolve
    await act(async () => {
      await Promise.resolve()
    })
    unmount()
    expect(hubState.unsubscribe).toHaveBeenCalled()
  })

  it('registers remote providers with the backend for active providers', async () => {
    hubState.getProviders.mockResolvedValue([
      {
        provider: 'openai',
        active: true,
        models: [{ id: 'gpt-4' }],
        custom_header: [{ header: 'X', value: 'Y' }],
        base_url: 'https://api',
      },
      {
        provider: 'llamacpp',
        active: true,
        models: [],
        custom_header: [],
      },
    ])
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith(
        'register_provider_config',
        expect.objectContaining({
          request: expect.objectContaining({
            provider: 'openai',
            api_key: 'key-1',
            models: ['gpt-4'],
          }),
        }),
      )
    })
    // llamacpp should be skipped
    const calls = h.invoke.mock.calls.filter(
      (c) => c[0] === 'register_provider_config' && (c[1] as { request: { provider: string } }).request.provider === 'llamacpp',
    )
    expect(calls.length).toBe(0)
  })

  it('skips registration when provider has no API key chain', async () => {
    h.providerRemoteApiKeyChain.mockReturnValue([])
    h.providers = [
      { provider: 'openai', active: true, models: [], custom_header: [] },
    ]
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.providerRemoteApiKeyChain).toHaveBeenCalled()
    })
    const regCalls = h.invoke.mock.calls.filter((c) => c[0] === 'register_provider_config')
    expect(regCalls.length).toBe(0)
  })

  it('logs provider registration failures without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.invoke.mockRejectedValue(new Error('nope'))
    hubState.getProviders.mockResolvedValue([
      { provider: 'openai', active: true, models: [], custom_header: [] },
    ])
    render(<DataProvider />)
    await waitFor(() => {
      expect(err).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register provider openai'),
        expect.any(Error),
      )
    })
    err.mockRestore()
  })

  it('registers a listener for onModelImported events', async () => {
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.eventsOn).toHaveBeenCalledWith('onModelImported', expect.any(Function))
    })
  })

  it('skips update check when in dev mode', async () => {
    h.isDev.mockReturnValue(true)
    render(<DataProvider />)
    // Yield microtasks
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.checkForUpdate).not.toHaveBeenCalled()
  })

  it('runs initial update check and schedules periodic checks outside dev', async () => {
    vi.useFakeTimers()
    h.isDev.mockReturnValue(false)
    render(<DataProvider />)
    expect(h.checkForUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(h.checkForUpdate).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does not start server on mount when enableOnStartup is false', async () => {
    render(<DataProvider />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(hubState.getServerStatus).not.toHaveBeenCalled()
    expect(hubState.startServer).not.toHaveBeenCalled()
  })

  it('short-circuits when server is already running', async () => {
    h.localApi.enableOnStartup = true
    hubState.getServerStatus.mockResolvedValue(true)
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.setServerStatus).toHaveBeenCalledWith('running')
    })
    expect(hubState.startServer).not.toHaveBeenCalled()
  })

  it('starts default model and local API server when enabled', async () => {
    h.localApi.enableOnStartup = true
    h.localApi.defaultModelLocalApiServer = { model: 'm1', provider: 'openai' }
    h.getProviderByName.mockReturnValue({ provider: 'openai' })
    hubState.getServerStatus.mockResolvedValue(false)
    hubState.startServer.mockResolvedValue(2000)
    hubState.getActiveModels.mockResolvedValue(['m1'])
    h.providers = [{ provider: 'openai', models: [{ id: 'm1' }] }]

    render(<DataProvider />)

    await waitFor(() => {
      expect(h.setServerStatus).toHaveBeenCalledWith('pending')
      expect(hubState.startModel).toHaveBeenCalled()
      expect(hubState.startServer).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(h.setServerPort).toHaveBeenCalledWith(2000)
      expect(h.setServerStatus).toHaveBeenCalledWith('running')
      expect(h.setLastServerModels).toHaveBeenCalledWith([
        { model: 'm1', provider: 'openai' },
      ])
    })
  })

  it('sets server status to stopped on startup failure', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.localApi.enableOnStartup = true
    hubState.getServerStatus.mockRejectedValue(new Error('fail'))
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.setServerStatus).toHaveBeenCalledWith('stopped')
    })
    err.mockRestore()
  })

  it('navigates to hub model route when handling a valid deep link', async () => {
    const deeplinkUrl = 'jan://host/action/owner/repo'
    hubState.deeplinkGetCurrent.mockResolvedValue([deeplinkUrl])
    render(<DataProvider />)
    await waitFor(() => {
      expect(h.navigate).toHaveBeenCalledWith({
        to: '/hub/model',
        search: { repo: 'owner/repo' },
      })
    })
  })

  it('ignores deep links with insufficient path segments', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue(['jan://only'])
    render(<DataProvider />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('ignores null deep link payload', async () => {
    hubState.deeplinkGetCurrent.mockResolvedValue(null)
    render(<DataProvider />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.navigate).not.toHaveBeenCalled()
  })
})
