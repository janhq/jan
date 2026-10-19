import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ storage: new Map<string, string>() }))
vi.mock('@/lib/backendStorage', () => ({ backendStorage: {
  getItem: async (key: string) => h.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { h.storage.set(key, value) },
  removeItem: async (key: string) => { h.storage.delete(key) },
} }))
import { useFavoriteModel } from '../useFavoriteModel'
import { localStorageKey } from '@/constants/localStorage'

describe('favorite provider migration through persisted storage', () => {
  beforeEach(() => {
    useFavoriteModel.setState({ favoriteModels: [] })
    h.storage.clear()
  })

  it('binds only unique legacy owners, retaining ambiguous and unavailable records', async () => {
    h.storage.set(localStorageKey.modelProvider, JSON.stringify({ state: { providers: [
      { provider: 'alpha', models: [{ id: 'unique' }, { id: 'shared' }] },
      { provider: 'beta', models: [{ id: 'shared' }] },
    ] }, version: 3 }))
    h.storage.set(localStorageKey.favoriteModels, JSON.stringify({ state: { favoriteModels: [
      { id: 'unique' }, { id: 'shared' }, { id: 'unavailable' },
    ] }, version: 0 }))
    await useFavoriteModel.persist.rehydrate()
    const state = useFavoriteModel.getState()
    expect(state.isFavorite('unique', 'alpha')).toBe(true)
    expect(state.isFavorite('unique', 'beta')).toBe(false)
    expect(state.isFavorite('shared', 'alpha')).toBe(false)
    expect(state.isFavorite('shared', 'beta')).toBe(false)
    expect(state.favoriteModels).toEqual([
      { id: 'unique', provider: 'alpha' }, { id: 'shared' }, { id: 'unavailable' },
    ])
    state.toggleFavorite({ id: 'shared' }, 'beta')
    expect(useFavoriteModel.getState().favoriteModels).toEqual([
      { id: 'unique', provider: 'alpha' }, { id: 'unavailable' }, { id: 'shared', provider: 'beta' },
    ])
    expect(JSON.parse(h.storage.get(localStorageKey.favoriteModels)!).version).toBe(1)
  })

  it('retains legacy entries when the provider snapshot cannot be read', async () => {
    h.storage.set(localStorageKey.modelProvider, 'invalid json')
    h.storage.set(localStorageKey.favoriteModels, JSON.stringify({ state: { favoriteModels: [{ id: 'saved' }] }, version: 0 }))
    await useFavoriteModel.persist.rehydrate()
    expect(useFavoriteModel.getState().favoriteModels).toEqual([{ id: 'saved' }])
  })

  it('preserves explicit ownership when rehydrating the new format', async () => {
    h.storage.set(localStorageKey.favoriteModels, JSON.stringify({ state: { favoriteModels: [
      { id: 'same', provider: 'alpha' }, { id: 'same', provider: 'beta' },
    ] }, version: 1 }))
    await useFavoriteModel.persist.rehydrate()
    useFavoriteModel.getState().removeFavorite('same', 'alpha')
    expect(useFavoriteModel.getState().favoriteModels).toEqual([{ id: 'same', provider: 'beta' }])
  })
})
