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
  getServiceHub: vi.fn(() => ({ path: () => ({ sep: () => '/' }) })),
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: { modelProvider: 'jan-model-provider' },
}))

const makeProvider = (provider: string, models: any[] = [], extra: any = {}) => ({
  provider, active: true, models, settings: [], ...extra,
} as any)

const resetStore = () => {
  act(() => {
    useModelProvider.setState({
      providers: [], selectedProvider: 'llamacpp', selectedModel: null, deletedModels: [],
    })
  })
}

describe('useModelProvider - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('getModelBy', () => {
    it('returns undefined when no provider, finds model in selected provider', () => {
      const { result } = renderHook(() => useModelProvider())
      expect(result.current.getModelBy('any-model')).toBeUndefined()

      act(() => {
        useModelProvider.setState({
          providers: [makeProvider('llamacpp', [{ id: 'model-1', capabilities: [] }])],
          selectedProvider: 'llamacpp',
        })
      })
      expect(result.current.getModelBy('model-1')).toBeDefined()
      expect(result.current.getModelBy('nonexistent')).toBeUndefined()
    })
  })

  describe('selectModelProvider', () => {
    it('finds and sets model, returns undefined for missing', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [makeProvider('openai', [{ id: 'gpt-4', capabilities: [] }])],
        })
      })

      let model: any
      act(() => { model = result.current.selectModelProvider('openai', 'gpt-4') })
      expect(model?.id).toBe('gpt-4')
      expect(result.current.selectedProvider).toBe('openai')

      act(() => { model = result.current.selectModelProvider('openai', 'nonexistent') })
      expect(model).toBeUndefined()
      expect(result.current.selectedModel).toBeNull()

      act(() => { model = result.current.selectModelProvider('unknown', 'model') })
      expect(model).toBeUndefined()
    })
  })

  describe('updateProvider', () => {
    it('updates matching, does not affect others', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        result.current.addProvider(makeProvider('openai'))
        result.current.addProvider(makeProvider('anthropic'))
      })

      act(() => { result.current.updateProvider('openai', { active: false, api_key: 'sk-123' } as any) })
      expect(result.current.getProviderByName('openai')?.active).toBe(false)
      expect(result.current.getProviderByName('openai')?.api_key).toBe('sk-123')
      expect(result.current.getProviderByName('anthropic')?.active).toBe(true)
    })
  })

  describe('deleteModel', () => {
    it('removes model and tracks in deletedModels', () => {
      const { result } = renderHook(() => useModelProvider())
      act(() => {
        useModelProvider.setState({
          providers: [makeProvider('llamacpp', [{ id: 'm1', capabilities: [] }, { id: 'm2', capabilities: [] }])],
          deletedModels: [],
        })
      })

      act(() => { result.current.deleteModel('m1') })
      expect(result.current.getProviderByName('llamacpp')?.models).toHaveLength(1)
      expect(result.current.deletedModels).toContain('m1')
    })

    it('handles non-array deletedModels gracefully', () => {
      const { result } = renderHook(() => useModelProvider())
      act(() => {
        useModelProvider.setState({
          providers: [makeProvider('p1', [{ id: 'm1', capabilities: [] }])],
          deletedModels: null as any,
        })
      })
      act(() => { result.current.deleteModel('m1') })
      expect(result.current.deletedModels).toContain('m1')
    })
  })

  describe('deleteProvider', () => {
    it('removes provider', () => {
      const { result } = renderHook(() => useModelProvider())
      act(() => {
        result.current.addProvider(makeProvider('openai'))
        result.current.addProvider(makeProvider('anthropic'))
      })
      act(() => { result.current.deleteProvider('openai') })
      expect(result.current.getProviderByName('openai')).toBeUndefined()
      expect(result.current.getProviderByName('anthropic')).toBeDefined()
    })
  })

  describe('setProviders', () => {
    it('merges with existing, excludes deleted models, filters legacy llama.cpp', () => {
      const { result } = renderHook(() => useModelProvider())

      // Setup with custom provider and deleted model
      act(() => {
        useModelProvider.setState({
          providers: [
            makeProvider('custom', [{ id: 'custom-m', capabilities: [] }]),
            makeProvider('llama.cpp', [{ id: 'old', capabilities: [] }]),
          ],
          deletedModels: ['model-deleted'],
        })
      })

      act(() => {
        result.current.setProviders([
          makeProvider('openai', [
            { id: 'model-deleted', capabilities: [] },
            { id: 'model-keep', capabilities: [] },
          ]),
          makeProvider('llamacpp', [{ id: 'new-model', capabilities: [] }]),
        ])
      })

      expect(result.current.getProviderByName('openai')).toBeDefined()
      expect(result.current.getProviderByName('custom')).toBeDefined()
      expect(result.current.getProviderByName('llama.cpp')).toBeUndefined()
      const openai = result.current.getProviderByName('openai')
      expect(openai?.models.find((m: any) => m.id === 'model-deleted')).toBeUndefined()
      expect(openai?.models.find((m: any) => m.id === 'model-keep')).toBeDefined()
    })

    it('merges persist provider settings and capabilities', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [makeProvider('llamacpp', [
            { id: 'model-1', capabilities: ['completion'], settings: { temperature: { value: 0.5 } } },
          ], { settings: [{ key: 'base-url', controller_props: { value: 'http://localhost' } }] })],
        })
      })

      act(() => {
        result.current.setProviders([makeProvider('llamacpp', [
          { id: 'model-1', capabilities: ['completion', 'vision'], settings: {} },
        ], { persist: true, settings: [{ key: 'base-url', controller_props: { placeholder: 'default' } }] })])
      })

      const provider = result.current.getProviderByName('llamacpp')
      expect(provider?.models[0].id).toBe('model-1')
    })

    it('merges non-persist provider preserving existing api_key/base_url', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [makeProvider('openai', [{ id: 'existing', capabilities: [] }], {
            settings: [{ key: 'api-key', controller_props: { value: 'sk-123' } }],
            api_key: 'sk-existing', base_url: 'https://custom.api.com',
            api_key_fallbacks: ['fallback'],
          })],
        })
      })

      act(() => {
        result.current.setProviders([makeProvider('openai', [
          { id: 'new-model', capabilities: [] },
          { id: 'existing', capabilities: [] },
        ], { api_key: '', base_url: '' })])
      })

      const provider = result.current.getProviderByName('openai')
      expect(provider?.api_key).toBe('sk-existing')
      expect(provider?.base_url).toBe('https://custom.api.com')
      expect(provider?.api_key_fallbacks).toEqual(['fallback'])
      expect(provider?.models.find((m: any) => m.id === 'new-model')).toBeDefined()
    })

    it('cortex migration: migrates legacy llama.cpp models', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [makeProvider('llama.cpp', [{ id: 'legacy:model:file', capabilities: [], settings: { temp: 0.5 } }])],
        })
      })

      localStorage.removeItem('cortex_model_settings_migrated')

      act(() => {
        result.current.setProviders([makeProvider('llamacpp', [{ id: 'legacy/model', capabilities: [] }], { persist: true })])
      })

      expect(localStorage.getItem('cortex_model_settings_migrated')).toBe('true')
    })
  })

  describe('migrations', () => {
    const getMigrate = () => {
      const persistApi = (useModelProvider as any).persist
      return persistApi?.getOptions().migrate as ((state: unknown, version: number) => any) | undefined
    }

    it.each([
      [7, 'removing proactive capability', {
        providers: [{ provider: 'openai', models: [{ id: 'm1', capabilities: ['tools', 'proactive', 'vision'], settings: {} }], settings: [] }],
        deletedModels: [],
      }, (migrated: any) => {
        expect(migrated.providers[0].models[0].capabilities).toEqual(['tools', 'vision'])
      }],
      [9, 'removing cohere provider', {
        providers: [
          { provider: 'cohere', models: [], settings: [] },
          { provider: 'openai', models: [], settings: [] },
        ],
        deletedModels: [],
      }, (migrated: any) => {
        expect(migrated.providers.find((p: any) => p.provider === 'cohere')).toBeUndefined()
        expect(migrated.providers.find((p: any) => p.provider === 'openai')).toBeDefined()
      }],
      [10, 'adding auto_increase_ctx_len', {
        providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: {}, capabilities: [] }], settings: [] }],
        deletedModels: [],
      }, (migrated: any) => {
        expect(migrated.providers[0].models[0].settings.auto_increase_ctx_len).toBeDefined()
      }],
      [3, 'Anthropic provider migration', {
        providers: [{
          provider: 'anthropic', models: [],
          base_url: 'https://api.anthropic.com',
          settings: [{ key: 'base-url', controller_props: { value: 'https://api.anthropic.com', placeholder: 'https://api.anthropic.com' } }],
        }],
        deletedModels: [],
      }, (migrated: any) => {
        expect(migrated.providers[0].base_url).toBe('https://api.anthropic.com/v1')
        expect(migrated.providers[0].custom_header).toBeDefined()
      }],
      [0, 'adding model settings at version 0', {
        providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: {} }], settings: [{ key: 'cont_batching', description: 'old' }] }],
        deletedModels: [],
      }, (migrated: any) => {
        expect(migrated.providers[0].settings[0].description).toBe('Enable continuous batching (a.k.a dynamic batching) for concurrent requests.')
        expect(migrated.providers[0].models[0].settings.chat_template).toBeDefined()
      }],
      [2, 'adding batch_size', {
        providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: {} }], settings: [] }],
        deletedModels: [],
      }, (migrated: any) => {
        expect(migrated.providers[0].models[0].settings.batch_size).toBeDefined()
      }],
      [4, 'adding cpu_moe and n_cpu_moe', {
        providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: {} }], settings: [] }],
        deletedModels: [],
      }, (migrated: any) => {
        expect(migrated.providers[0].models[0].settings.cpu_moe).toBeDefined()
        expect(migrated.providers[0].models[0].settings.n_cpu_moe).toBeDefined()
      }],
    ])('handles version <= %i: %s', (version, _label, state, verify) => {
      const migrate = getMigrate()
      if (migrate) {
        const migrated = migrate(state, version)
        verify(migrated)
      }
    })
  })
})
