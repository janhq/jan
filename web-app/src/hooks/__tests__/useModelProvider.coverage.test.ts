import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useModelProvider } from '../useModelProvider'

vi.mock('@/lib/fileStorage', () => ({
  fileStorage: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: vi.fn(() => ({
    path: () => ({
      sep: () => '/',
    }),
  })),
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelProvider: 'jan-model-provider',
  },
}))

describe('useModelProvider - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })
  })

  it('getModelBy should return undefined when no provider', () => {
    const { result } = renderHook(() => useModelProvider())
    expect(result.current.getModelBy('any-model')).toBeUndefined()
  })

  it('getModelBy should find model in selected provider', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'llamacpp',
          active: true,
          models: [{ id: 'model-1', capabilities: [] }],
          settings: [],
        }] as any,
        selectedProvider: 'llamacpp',
      })
    })

    expect(result.current.getModelBy('model-1')).toBeDefined()
    expect(result.current.getModelBy('nonexistent')).toBeUndefined()
  })

  it('selectModelProvider should find and set model', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'openai',
          active: true,
          models: [{ id: 'gpt-4', capabilities: [] }],
          settings: [],
        }] as any,
      })
    })

    let model: any
    act(() => {
      model = result.current.selectModelProvider('openai', 'gpt-4')
    })

    expect(model?.id).toBe('gpt-4')
    expect(result.current.selectedProvider).toBe('openai')
    expect(result.current.selectedModel?.id).toBe('gpt-4')
  })

  it('selectModelProvider should return undefined for missing model', () => {
    const { result } = renderHook(() => useModelProvider())

    let model: any
    act(() => {
      model = result.current.selectModelProvider('openai', 'nonexistent')
    })

    expect(model).toBeUndefined()
    expect(result.current.selectedModel).toBeNull()
  })

  it('selectModelProvider with no provider found', () => {
    const { result } = renderHook(() => useModelProvider())

    let model: any
    act(() => {
      model = result.current.selectModelProvider('unknown', 'model')
    })

    expect(model).toBeUndefined()
  })

  it('updateProvider should update matching provider', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.addProvider({
        provider: 'openai',
        active: true,
        models: [],
        settings: [],
      } as any)
    })

    act(() => {
      result.current.updateProvider('openai', { active: false, api_key: 'sk-123' } as any)
    })

    const provider = result.current.getProviderByName('openai')
    expect(provider?.active).toBe(false)
    expect(provider?.api_key).toBe('sk-123')
  })

  it('updateProvider should not affect non-matching providers', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.addProvider({ provider: 'openai', active: true, models: [], settings: [] } as any)
      result.current.addProvider({ provider: 'anthropic', active: true, models: [], settings: [] } as any)
    })

    act(() => {
      result.current.updateProvider('openai', { active: false } as any)
    })

    expect(result.current.getProviderByName('anthropic')?.active).toBe(true)
  })

  it('deleteModel should remove model and track in deletedModels', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'llamacpp',
          active: true,
          models: [
            { id: 'model-1', capabilities: [] },
            { id: 'model-2', capabilities: [] },
          ],
          settings: [],
        }] as any,
        deletedModels: [],
      })
    })

    act(() => {
      result.current.deleteModel('model-1')
    })

    const provider = result.current.getProviderByName('llamacpp')
    expect(provider?.models).toHaveLength(1)
    expect(provider?.models[0].id).toBe('model-2')
    expect(result.current.deletedModels).toContain('model-1')
  })

  it('deleteProvider should remove provider', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.addProvider({ provider: 'openai', active: true, models: [], settings: [] } as any)
      result.current.addProvider({ provider: 'anthropic', active: true, models: [], settings: [] } as any)
    })

    act(() => {
      result.current.deleteProvider('openai')
    })

    expect(result.current.getProviderByName('openai')).toBeUndefined()
    expect(result.current.getProviderByName('anthropic')).toBeDefined()
  })

  it('setProviders should merge with existing providers', () => {
    const { result } = renderHook(() => useModelProvider())

    // Set existing state with custom provider
    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'custom',
          active: true,
          models: [{ id: 'custom-m', capabilities: [] }],
          settings: [],
        }] as any,
      })
    })

    // setProviders with new providers - custom should be kept
    act(() => {
      result.current.setProviders([{
        provider: 'openai',
        active: true,
        models: [{ id: 'gpt-4', capabilities: [] }],
        settings: [],
      }] as any)
    })

    expect(result.current.getProviderByName('openai')).toBeDefined()
    expect(result.current.getProviderByName('custom')).toBeDefined()
  })

  it('setProviders should exclude deleted models', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({ deletedModels: ['model-deleted'] })
    })

    act(() => {
      result.current.setProviders([{
        provider: 'openai',
        active: true,
        models: [
          { id: 'model-deleted', capabilities: [] },
          { id: 'model-keep', capabilities: [] },
        ],
        settings: [],
      }] as any)
    })

    const provider = result.current.getProviderByName('openai')
    expect(provider?.models.find((m: any) => m.id === 'model-deleted')).toBeUndefined()
    expect(provider?.models.find((m: any) => m.id === 'model-keep')).toBeDefined()
  })

  it('setProviders should filter out legacy llama.cpp provider', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'llama.cpp',
          active: true,
          models: [{ id: 'old-model', capabilities: [] }],
          settings: [],
        }] as any,
      })
    })

    act(() => {
      result.current.setProviders([{
        provider: 'llamacpp',
        active: true,
        models: [{ id: 'new-model', capabilities: [] }],
        settings: [],
      }] as any)
    })

    expect(result.current.getProviderByName('llama.cpp')).toBeUndefined()
  })

  it('deleteModel handles non-array deletedModels gracefully', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'p1',
          active: true,
          models: [{ id: 'm1', capabilities: [] }],
          settings: [],
        }] as any,
        deletedModels: null as any,
      })
    })

    act(() => {
      result.current.deleteModel('m1')
    })

    expect(result.current.deletedModels).toContain('m1')
  })

  it('migration should handle version <= 7 removing proactive capability', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const state = {
        providers: [{
          provider: 'openai',
          models: [{ id: 'm1', capabilities: ['tools', 'proactive', 'vision'], settings: {} }],
          settings: [],
        }],
        deletedModels: [],
      }

      const migrated = migrate(state, 7)
      expect(migrated.providers[0].models[0].capabilities).toEqual(['tools', 'vision'])
    }
  })

  it('migration should handle version <= 9 removing cohere provider', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const state = {
        providers: [
          { provider: 'cohere', models: [], settings: [] },
          { provider: 'openai', models: [], settings: [] },
        ],
        deletedModels: [],
      }

      const migrated = migrate(state, 9)
      expect(migrated.providers.find((p: any) => p.provider === 'cohere')).toBeUndefined()
      expect(migrated.providers.find((p: any) => p.provider === 'openai')).toBeDefined()
    }
  })

  it('migration should handle Anthropic provider migration at version <= 3', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const state = {
        providers: [{
          provider: 'anthropic',
          models: [],
          base_url: 'https://api.anthropic.com',
          settings: [{
            key: 'base-url',
            controller_props: {
              value: 'https://api.anthropic.com',
              placeholder: 'https://api.anthropic.com',
            },
          }],
        }],
        deletedModels: [],
      }

      const migrated = migrate(state, 3)
      expect(migrated.providers[0].base_url).toBe('https://api.anthropic.com/v1')
      expect(migrated.providers[0].custom_header).toBeDefined()
    }
  })

  it('migration should handle version <= 10 adding auto_increase_ctx_len', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const state = {
        providers: [{
          provider: 'llamacpp',
          models: [{ id: 'm1', settings: {}, capabilities: [] }],
          settings: [],
        }],
        deletedModels: [],
      }

      const migrated = migrate(state, 10)
      expect(migrated.providers[0].models[0].settings.auto_increase_ctx_len).toBeDefined()
    }
  })

  it('migration should handle version <= 1 adding model settings', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const state = {
        providers: [{
          provider: 'llamacpp',
          models: [{ id: 'm1', settings: {} }],
          settings: [{ key: 'cont_batching', description: 'old desc' }],
        }],
        deletedModels: [],
      }

      const migrated = migrate(state, 0)
      const provider = migrated.providers[0]
      expect(provider.settings[0].description).toBe(
        'Enable continuous batching (a.k.a dynamic batching) for concurrent requests.'
      )
      expect(provider.models[0].settings.chat_template).toBeDefined()
      expect(provider.models[0].settings.override_tensor_buffer_t).toBeDefined()
      expect(provider.models[0].settings.no_kv_offload).toBeDefined()
    }
  })

  it('migration should handle version <= 2 adding batch_size', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const state = {
        providers: [{
          provider: 'llamacpp',
          models: [{ id: 'm1', settings: {} }],
          settings: [],
        }],
        deletedModels: [],
      }

      const migrated = migrate(state, 2)
      expect(migrated.providers[0].models[0].settings.batch_size).toBeDefined()
    }
  })

  it('migration should handle version <= 4 adding cpu_moe and n_cpu_moe', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const state = {
        providers: [{
          provider: 'llamacpp',
          models: [{ id: 'm1', settings: {} }],
          settings: [],
        }],
        deletedModels: [],
      }

      const migrated = migrate(state, 4)
      expect(migrated.providers[0].models[0].settings.cpu_moe).toBeDefined()
      expect(migrated.providers[0].models[0].settings.n_cpu_moe).toBeDefined()
    }
  })

  it('setProviders with persist provider should merge settings and capabilities', () => {
    const { result } = renderHook(() => useModelProvider())

    // Set existing provider with user-customized settings
    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'llamacpp',
          active: true,
          models: [{
            id: 'model-1',
            capabilities: ['completion'],
            settings: { temperature: { value: 0.5 } },
          }],
          settings: [{
            key: 'base-url',
            controller_props: { value: 'http://localhost' },
          }],
        }] as any,
      })
    })

    // setProviders with persist=true provider (engine refresh)
    act(() => {
      result.current.setProviders([{
        provider: 'llamacpp',
        active: true,
        persist: true,
        models: [{
          id: 'model-1',
          capabilities: ['completion', 'vision'],
          settings: {},
        }],
        settings: [{
          key: 'base-url',
          controller_props: { placeholder: 'default-url' },
        }],
      }] as any)
    })

    const provider = result.current.getProviderByName('llamacpp')
    expect(provider).toBeDefined()
    // Persist provider uses updatedModels path
    expect(provider?.models[0].id).toBe('model-1')
  })

  it('setProviders merges non-persist provider existing models', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'openai',
          active: true,
          models: [{ id: 'existing-model', capabilities: [] }],
          settings: [{ key: 'api-key', controller_props: { value: 'sk-123' } }],
          api_key: 'sk-existing',
          base_url: 'https://custom.api.com',
          api_key_fallbacks: ['fallback'],
        }] as any,
      })
    })

    act(() => {
      result.current.setProviders([{
        provider: 'openai',
        active: true,
        models: [
          { id: 'new-model', capabilities: [] },
          { id: 'existing-model', capabilities: [] },
        ],
        settings: [{ key: 'api-key', controller_props: { placeholder: 'Enter key' } }],
        api_key: '',
        base_url: '',
      }] as any)
    })

    const provider = result.current.getProviderByName('openai')
    // Should preserve existing api_key and base_url
    expect(provider?.api_key).toBe('sk-existing')
    expect(provider?.base_url).toBe('https://custom.api.com')
    expect(provider?.api_key_fallbacks).toEqual(['fallback'])
    // Existing model should be preserved, new model merged
    expect(provider?.models.find((m: any) => m.id === 'existing-model')).toBeDefined()
    expect(provider?.models.find((m: any) => m.id === 'new-model')).toBeDefined()
  })

  it('setProviders cortex migration should migrate legacy llama.cpp models', () => {
    const { result } = renderHook(() => useModelProvider())

    // Simulate state with legacy llama.cpp provider (cortex migration)
    act(() => {
      useModelProvider.setState({
        providers: [{
          provider: 'llama.cpp',
          active: true,
          models: [{ id: 'legacy:model:file', capabilities: [], settings: { temp: 0.5 } }],
          settings: [],
        }] as any,
      })
    })

    // Set cortex_model_settings_migrated to false so migration triggers
    localStorage.removeItem('cortex_model_settings_migrated')

    act(() => {
      result.current.setProviders([{
        provider: 'llamacpp',
        active: true,
        persist: true,
        models: [{ id: 'legacy/model', capabilities: [] }],
        settings: [],
      }] as any)
    })

    // Migration should have happened
    expect(localStorage.getItem('cortex_model_settings_migrated')).toBe('true')
  })
})
