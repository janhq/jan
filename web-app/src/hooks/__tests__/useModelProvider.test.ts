import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useModelProvider } from '../useModelProvider'

// Mock getServiceHub
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: vi.fn(() => ({
    path: () => ({
      sep: () => '/',
    }),
  })),
}))

// Mock the localStorage key constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelProvider: 'jan-model-provider',
  },
}))

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('useModelProvider - displayName functionality', () => {
  beforeEach(() => {
    // Reset the mock implementations instead of clearing them
    localStorageMock.getItem.mockReturnValue(null)
    localStorageMock.setItem.mockClear()
    localStorageMock.removeItem.mockClear()
    localStorageMock.clear.mockClear()

    // Reset Zustand store to default state
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })
  })

  it('should handle models without displayName property', () => {
    const { result } = renderHook(() => useModelProvider())

    const provider = {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // First add the provider, then update it (since updateProvider only updates existing providers)
    act(() => {
      result.current.addProvider(provider)
    })

    const updatedProvider = result.current.getProviderByName('llamacpp')
    expect(updatedProvider?.models[0].displayName).toBeUndefined()
    expect(updatedProvider?.models[0].id).toBe('test-model.gguf')
  })

  it('should preserve displayName when merging providers in setProviders', () => {
    const { result } = renderHook(() => useModelProvider())

    // First, set up initial state with displayName via direct state manipulation
    // This simulates the scenario where a user has already customized a display name
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            active: true,
            models: [
              {
                id: 'test-model.gguf',
                displayName: 'My Custom Model',
                capabilities: ['completion'],
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })

    // Now simulate setProviders with fresh data (like from server refresh)
    const freshProviders = [
      {
        provider: 'llamacpp',
        active: true,
        persist: true,
        models: [
          {
            id: 'test-model.gguf',
            capabilities: ['completion'],
            // Note: no displayName in fresh data
          },
        ],
        settings: [],
      },
    ] as any

    act(() => {
      result.current.setProviders(freshProviders)
    })

    // The displayName should be preserved from existing state
    const provider = result.current.getProviderByName('llamacpp')
    expect(provider?.models[0].displayName).toBe('My Custom Model')
  })

  it('should preserve user-controlled capabilities but always pick up engine-owned ones (vision/audio/embeddings) on refresh', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            active: true,
            models: [
              {
                id: 'test-model.gguf',
                capabilities: ['completion'],
                _userConfiguredCapabilities: true,
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })

    const freshProviders = [
      {
        provider: 'llamacpp',
        active: true,
        persist: true,
        models: [
          {
            id: 'test-model.gguf',
            capabilities: ['completion', 'vision', 'tools'],
          },
        ],
        settings: [],
      },
    ] as any

    act(() => {
      result.current.setProviders(freshProviders)
    })

    const provider = result.current.getProviderByName('llamacpp')
    expect(provider?.models[0].capabilities).toEqual(['completion', 'vision'])
    expect(
      (provider?.models[0] as { _userConfiguredCapabilities?: boolean })
        ._userConfiguredCapabilities
    ).toBe(true)
  })

  it('should provide basic functionality without breaking existing behavior', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that basic provider operations work
    expect(result.current.providers).toEqual([])
    expect(result.current.selectedProvider).toBe('llamacpp')
    expect(result.current.selectedModel).toBeNull()

    // Test addProvider functionality
    const provider = {
      provider: 'openai',
      active: true,
      models: [],
      settings: [],
    } as any

    act(() => {
      result.current.addProvider(provider)
    })

    expect(result.current.providers).toHaveLength(1)
    expect(result.current.getProviderByName('openai')).toBeDefined()
  })

  it('should handle provider operations with models that have displayName', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that we can at least get and set providers with displayName models
    const providerWithDisplayName = {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          displayName: 'Custom Model Name',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // Set the state directly (simulating what would happen in real usage)
    act(() => {
      useModelProvider.setState({
        providers: [providerWithDisplayName],
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })

    const provider = result.current.getProviderByName('llamacpp')
    expect(provider?.models[0].displayName).toBe('Custom Model Name')
    expect(provider?.models[0].id).toBe('test-model.gguf')
  })
})

describe('useModelProvider migrations', () => {
  it('migrates flash_attn setting to dropdown with default value', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'llamacpp',
          models: [],
          settings: [
            {
              key: 'flash_attn',
              controller_type: 'toggle',
              controller_props: {
                value: 'ON',
              },
            },
          ],
        },
      ],
      selectedProvider: 'llamacpp',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 5)
    const flashAttnSetting = migratedState.providers[0].settings.find(
      (setting: any) => setting.key === 'flash_attn'
    )

    expect(flashAttnSetting.controller_type).toBe('dropdown')
    expect(flashAttnSetting.controller_props.value).toBe('auto')
    expect(flashAttnSetting.controller_props.options).toEqual([
      { name: 'Auto', value: 'auto' },
      { name: 'On', value: 'on' },
      { name: 'Off', value: 'off' },
    ])
  })

  it('overwrites stale base_url and strips base-url setting for predefined providers', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'anthropic',
          models: [],
          base_url: 'https://api.anthropic.com',
          settings: [
            { key: 'api-key', controller_props: { value: 'sk-x' } },
            {
              key: 'base-url',
              controller_props: {
                value: 'https://api.anthropic.com',
                placeholder: 'https://api.anthropic.com',
              },
            },
          ],
        },
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [
            {
              key: 'base-url',
              controller_props: { value: 'https://api.mistral.ai' },
            },
          ],
        },
        {
          provider: 'my-custom',
          models: [],
          base_url: 'https://example.com/v1',
          settings: [
            {
              key: 'base-url',
              controller_props: { value: 'https://example.com/v1' },
            },
          ],
        },
      ],
      selectedProvider: 'anthropic',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 13)
    const [anthropic, mistral, custom] = migratedState.providers

    expect(anthropic.base_url).toBe('https://api.anthropic.com/v1')
    expect(
      anthropic.settings.find((s: any) => s.key === 'base-url')
    ).toBeUndefined()
    expect(
      anthropic.settings.find((s: any) => s.key === 'api-key')
    ).toBeDefined()

    expect(mistral.base_url).toBe('https://api.mistral.ai/v1')
    expect(
      mistral.settings.find((s: any) => s.key === 'base-url')
    ).toBeUndefined()

    // Custom providers (not in predefinedProviders) are left alone.
    expect(custom.base_url).toBe('https://example.com/v1')
    expect(
      custom.settings.find((s: any) => s.key === 'base-url')
    ).toBeDefined()
  })

  it('does not affect other providers during Mistral migration', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [],
        },
        {
          provider: 'openai',
          models: [],
          base_url: 'https://api.openai.com/v1',
          settings: [],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 8)

    expect(migratedState.providers[0].base_url).toBe('https://api.mistral.ai/v1')
    expect(migratedState.providers[1].base_url).toBe('https://api.openai.com/v1')
  })

  it('backfills api_type on the built-in anthropic provider (v15 → v16)', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'anthropic',
          models: [],
          base_url: 'https://api.anthropic.com/v1',
          settings: [],
        },
        {
          provider: 'openai',
          models: [],
          base_url: 'https://api.openai.com/v1',
          settings: [],
        },
        {
          provider: 'my-anthropic-proxy',
          models: [],
          api_type: 'anthropic',
          base_url: 'https://proxy.example.com/v1',
          settings: [],
        },
      ],
      selectedProvider: 'anthropic',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 15)
    const [anthropic, openai, customAnthropic] = migratedState.providers

    expect(anthropic.api_type).toBe('anthropic')
    expect(openai.api_type).toBeUndefined()
    // Pre-set api_type must round-trip untouched.
    expect(customAnthropic.api_type).toBe('anthropic')
  })

  it('backfills manuallyAdded on curated models (v17 → v18)', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'openrouter',
          base_url: 'https://openrouter.ai/api/v1',
          settings: [],
          models: [
            // User toggled capabilities → curated.
            { id: 'cap', name: 'cap', _userConfiguredCapabilities: true },
            // User renamed (displayName differs from name) → curated.
            { id: 'renamed', name: 'renamed', displayName: 'My Model' },
            // Catalog echoes displayName === name → NOT curated.
            { id: 'echo-name', name: 'echo-name', displayName: 'echo-name' },
            // Catalog echoes displayName === id → NOT curated.
            { id: 'echo-id', name: 'Some Name', displayName: 'echo-id' },
            // Plain auto-fetched model → untouched.
            { id: 'plain', name: 'plain' },
            // Already flagged → preserved.
            { id: 'already', name: 'already', manuallyAdded: true },
            // Imported models are recognized at read time, not backfilled here.
            { id: 'imported', name: 'imported', imported: true },
          ],
        },
      ],
      selectedProvider: 'openrouter',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 17)
    const byId = Object.fromEntries(
      migratedState.providers[0].models.map((m: Model) => [m.id, m])
    )

    expect(byId.cap.manuallyAdded).toBe(true)
    expect(byId.renamed.manuallyAdded).toBe(true)
    expect(byId['echo-name'].manuallyAdded).toBeUndefined()
    expect(byId['echo-id'].manuallyAdded).toBeUndefined()
    expect(byId.plain.manuallyAdded).toBeUndefined()
    expect(byId.already.manuallyAdded).toBe(true)
    expect(byId.imported.manuallyAdded).toBeUndefined()
  })
})
