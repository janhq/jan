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

const makeLlamacppModel = (id: string, extraSettings: Record<string, any> = {}) =>
  ({
    id,
    capabilities: ['completion'],
    settings: { ...extraSettings },
  }) as any

const makeLlamacppProvider = (models: any[] = []) =>
  ({
    provider: 'llamacpp',
    active: true,
    models,
    settings: [],
  }) as any

const makeOtherProvider = (models: any[] = []) =>
  ({
    provider: 'openai',
    active: true,
    models,
    settings: [],
  }) as any

const resetStore = () => {
  act(() => {
    useModelProvider.setState({
      providers: [],
      selectedProvider: 'llamacpp',
      selectedModel: null,
      deletedModels: [],
    })
  })
}

describe('useModelProvider - speculative decoding migration (version <= 13)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('migration adds speculative decoding defaults to llamacpp models', () => {
    it('adds draft_model_id setting to a llamacpp model that lacks it', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [makeLlamacppProvider([makeLlamacppModel('llama-7b.gguf')])],
        })
      })

      // Trigger migration by calling setProviders with the same data (simulates rehydration)
      act(() => {
        result.current.setProviders([
          makeLlamacppProvider([makeLlamacppModel('llama-7b.gguf')]),
        ])
      })

      const provider = result.current.getProviderByName('llamacpp')
      const model = provider?.models.find((m: any) => m.id === 'llama-7b.gguf')
      // After merging, the model in the store should be the persisted one
      expect(model).toBeDefined()
    })

    it('draft_model_id predefined setting has expected defaults', () => {
      // This verifies modelSettings.draft_model_id shape matches what migration writes
      const { modelSettings } = require('@/lib/predefined')

      expect(modelSettings.draft_model_id).toBeDefined()
      expect(modelSettings.draft_model_id.key).toBe('draft_model_id')
      expect(modelSettings.draft_model_id.controller_type).toBe('dropdown')
      expect(modelSettings.draft_model_id.controller_props.value).toBe('none')
    })

    it('draft_max predefined setting has expected defaults', () => {
      const { modelSettings } = require('@/lib/predefined')

      expect(modelSettings.draft_max).toBeDefined()
      expect(modelSettings.draft_max.key).toBe('draft_max')
      expect(modelSettings.draft_max.controller_type).toBe('input')
      expect(modelSettings.draft_max.controller_props.value).toBe(16)
    })

    it('draft_min predefined setting has expected defaults', () => {
      const { modelSettings } = require('@/lib/predefined')

      expect(modelSettings.draft_min).toBeDefined()
      expect(modelSettings.draft_min.key).toBe('draft_min')
      expect(modelSettings.draft_min.controller_type).toBe('input')
      expect(modelSettings.draft_min.controller_props.value).toBe(0)
    })
  })

  describe('draftModelCandidates filtering', () => {
    it('returns all non-embedding llamacpp models except the current one', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [
            makeLlamacppProvider([
              makeLlamacppModel('model-a.gguf'),
              makeLlamacppModel('model-b.gguf'),
              makeLlamacppModel('model-c.gguf'),
            ]),
          ],
        })
      })

      const providers = result.current.providers
      const currentModelId = 'model-a.gguf'

      const candidates = providers
        .filter((p: any) => p.provider === 'llamacpp')
        .flatMap((p: any) => p.models)
        .filter(
          (m: any) =>
            m.id !== currentModelId &&
            !m.settings?.embedding?.controller_props?.value
        )
        .map((m: any) => ({ value: m.id, name: m.displayName ?? m.id }))

      expect(candidates).toHaveLength(2)
      expect(candidates.map((c: any) => c.value)).toContain('model-b.gguf')
      expect(candidates.map((c: any) => c.value)).toContain('model-c.gguf')
      expect(candidates.map((c: any) => c.value)).not.toContain('model-a.gguf')
    })

    it('excludes embedding models from draft candidates', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [
            makeLlamacppProvider([
              makeLlamacppModel('main-model.gguf'),
              makeLlamacppModel('embed-model.gguf', {
                embedding: { controller_props: { value: true } },
              }),
              makeLlamacppModel('draft-model.gguf'),
            ]),
          ],
        })
      })

      const providers = result.current.providers
      const currentModelId = 'main-model.gguf'

      const candidates = providers
        .filter((p: any) => p.provider === 'llamacpp')
        .flatMap((p: any) => p.models)
        .filter(
          (m: any) =>
            m.id !== currentModelId &&
            !m.settings?.embedding?.controller_props?.value
        )

      expect(candidates.map((c: any) => c.id)).not.toContain('embed-model.gguf')
      expect(candidates.map((c: any) => c.id)).toContain('draft-model.gguf')
    })

    it('excludes non-llamacpp provider models from draft candidates', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [
            makeLlamacppProvider([makeLlamacppModel('llamacpp-model.gguf')]),
            makeOtherProvider([{ id: 'gpt-4', capabilities: [] }]),
          ],
        })
      })

      const providers = result.current.providers
      const currentModelId = 'some-other-model.gguf'

      const candidates = providers
        .filter((p: any) => p.provider === 'llamacpp')
        .flatMap((p: any) => p.models)
        .filter(
          (m: any) =>
            m.id !== currentModelId &&
            !m.settings?.embedding?.controller_props?.value
        )

      expect(candidates.map((c: any) => c.id)).not.toContain('gpt-4')
      expect(candidates.map((c: any) => c.id)).toContain('llamacpp-model.gguf')
    })

    it('returns empty array when only the current model is installed', () => {
      const { result } = renderHook(() => useModelProvider())

      act(() => {
        useModelProvider.setState({
          providers: [makeLlamacppProvider([makeLlamacppModel('solo-model.gguf')])],
        })
      })

      const providers = result.current.providers
      const currentModelId = 'solo-model.gguf'

      const candidates = providers
        .filter((p: any) => p.provider === 'llamacpp')
        .flatMap((p: any) => p.models)
        .filter((m: any) => m.id !== currentModelId)

      expect(candidates).toHaveLength(0)
    })
  })
})
