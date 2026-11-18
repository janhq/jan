import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
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

// Model ids are the list keys in the model picker and the settings page; a
// repeated id makes React keep stale rows, e.g. models that no longer match a
// search stay on screen.
const model = (id: string, extra: Partial<Model> = {}) =>
  ({ id, capabilities: ['completion'], ...extra }) as Model

const provider = (models: Model[]) =>
  ({
    provider: 'azure',
    active: true,
    base_url: 'https://my-resource.openai.azure.com/openai/v1',
    models,
    settings: [],
  }) as unknown as ModelProvider

const azureModelIds = () =>
  useModelProvider
    .getState()
    .providers.find((p) => p.provider === 'azure')!
    .models.map((m) => m.id)

describe('useModelProvider - unique model ids per provider', () => {
  beforeEach(() => {
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: 'llamacpp',
        selectedModel: null,
        deletedModels: [],
      })
    })
  })

  it('keeps one model per id when an update lists an id twice', () => {
    act(() => {
      useModelProvider.setState({ providers: [provider([])] })
      useModelProvider.getState().updateProvider('azure', {
        models: [
          model('Llama-3.3-70B-Instruct'),
          model('gpt-4o'),
          model('Llama-3.3-70B-Instruct'),
        ],
      })
    })

    expect(azureModelIds()).toEqual(['Llama-3.3-70B-Instruct', 'gpt-4o'])
  })

  it('cleans up duplicates already stored when providers are loaded', () => {
    act(() => {
      useModelProvider.setState({
        providers: [
          provider([
            model('Phi-3.5-mini-instruct', { displayName: 'Phi (mine)' }),
            model('Phi-3.5-mini-instruct'),
            model('gpt-4o'),
          ]),
        ],
      })
      useModelProvider.getState().setProviders([provider([])])
    })

    expect(azureModelIds()).toEqual(['Phi-3.5-mini-instruct', 'gpt-4o'])
    // The first occurrence wins, so a user's edits to it survive.
    const phi = useModelProvider
      .getState()
      .providers.find((p) => p.provider === 'azure')!
      .models.find((m) => m.id === 'Phi-3.5-mini-instruct')
    expect(phi?.displayName).toBe('Phi (mine)')
  })
})
