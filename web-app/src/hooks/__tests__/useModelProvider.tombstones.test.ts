import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ storage: new Map<string, string>() }))
vi.mock('@/lib/backendStorage', () => ({ backendStorage: {
  getItem: async (key: string) => h.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { h.storage.set(key, value) },
  removeItem: async (key: string) => { h.storage.delete(key) },
} }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ path: () => ({ sep: () => '/' }) }) }))
vi.mock('@/lib/utils', async (original) => ({
  ...await original<typeof import('@/lib/utils')>(),
  isLocalProvider: (provider: string) => provider === 'llamacpp' || provider === 'mlx',
}))
import { useModelProvider } from '../useModelProvider'
import { localStorageKey } from '@/constants/localStorage'

describe('persisted provider deletion records', () => {
  beforeEach(() => {
    useModelProvider.setState({ providers: [], selectedProvider: 'alpha', selectedModel: null, deletedModels: [] })
    h.storage.clear()
  })

  it('keeps version 19 global deletion records without guessing a historical owner', async () => {
    h.storage.set(localStorageKey.modelProvider, JSON.stringify({ version: 19, state: {
      providers: [], selectedProvider: 'alpha', selectedModel: null, deletedModels: ['historical'],
    } }))
    await useModelProvider.persist.rehydrate()
    expect(useModelProvider.getState().deletedModels).toEqual(['historical'])
    useModelProvider.getState().addDeletedModels(['new'], 'alpha')
    const saved = JSON.parse(h.storage.get(localStorageKey.modelProvider)!)
    expect(saved.version).toBe(20)
    expect(saved.state.deletedModels).toEqual(['historical', { provider: 'alpha', id: 'new' }])
  })

  it('rehydrates provider ownership and clears a local record only for its owner', async () => {
    h.storage.set(localStorageKey.modelProvider, JSON.stringify({ version: 20, state: {
      providers: [], selectedProvider: 'alpha', selectedModel: null,
      deletedModels: [{ provider: 'remote', id: 'shared' }, { provider: 'llamacpp', id: 'shared' }],
    } }))
    await useModelProvider.persist.rehydrate()
    useModelProvider.getState().setProviders([
      { provider: 'llamacpp', active: true, models: [{ id: 'shared' }], settings: [] },
      { provider: 'remote', active: true, models: [{ id: 'shared' }], settings: [] },
    ])
    expect(useModelProvider.getState().deletedModels).toEqual([{ provider: 'remote', id: 'shared' }])
    expect(useModelProvider.getState().getProviderByName('remote')?.models).toEqual([])
  })
})
