import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage, invoke } = vi.hoisted(() => ({
  storage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  invoke: vi.fn(),
}))
vi.mock('@/lib/backendStorage', () => ({ backendStorage: storage }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke }) }),
}))

import { DEFAULT_SEARCH_PROVIDER, useWebSearchConfig } from '../useWebSearchConfig'

describe('web search preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.getItem.mockResolvedValue(null)
    invoke.mockResolvedValue(null)
    useWebSearchConfig.setState({
      searchProvider: DEFAULT_SEARCH_PROVIDER, webSearchEnabled: true, apiKeys: {}, endpoints: {},
    })
  })

  it('uses DuckDuckGo when no preferences were saved', async () => {
    await useWebSearchConfig.persist.rehydrate()
    expect(useWebSearchConfig.getState().searchProvider).toBe('duckduckgo')
  })

  it('preserves an existing provider and disabled preference', async () => {
    storage.getItem.mockResolvedValue(JSON.stringify({ state: {
      searchProvider: 'tavily', webSearchEnabled: false, endpoints: {},
    }, version: 0 }))
    await useWebSearchConfig.persist.rehydrate()
    expect(useWebSearchConfig.getState()).toMatchObject({ searchProvider: 'tavily', webSearchEnabled: false })
  })

  it('does not read empty keyring keys for providers without API keys', async () => {
    await useWebSearchConfig.persist.rehydrate()
    expect(invoke).not.toHaveBeenCalledWith('get_secret', { key: '' })
    expect(invoke).toHaveBeenCalledWith('get_secret', { key: 'exa-api-key' })
  })

  it('persists provider selection without plaintext API keys', () => {
    useWebSearchConfig.getState().setApiKey('exa', 'private-test-key')
    useWebSearchConfig.getState().setSearchProvider('duckduckgo')
    const serialized = storage.setItem.mock.calls.at(-1)?.[1]
    expect(JSON.parse(serialized).state.searchProvider).toBe('duckduckgo')
    expect(serialized).not.toContain('private-test-key')
  })
})
