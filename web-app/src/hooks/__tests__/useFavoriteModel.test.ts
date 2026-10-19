import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useFavoriteModel } from '../useFavoriteModel'
import { act } from '@testing-library/react'

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    favoriteModels: 'favorite-models',
  },
}))

vi.mock('@/lib/fileStorage', () => ({
  fileStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}))

const makeModel = (id: string): Model =>
  ({ id, name: id, engine: 'llamacpp' } as any)

describe('useFavoriteModel', () => {
  beforeEach(() => {
    act(() => {
      useFavoriteModel.setState({ favoriteModels: [] })
    })
  })

  it('should start with empty favorites', () => {
    const state = useFavoriteModel.getState()
    expect(state.favoriteModels).toEqual([])
  })

  it('keeps same-id favorites from two providers independent', () => {
    const store = useFavoriteModel.getState()
    store.addFavorite(makeModel('shared'), 'alpha')
    expect(store.isFavorite('shared', 'beta')).toBe(false)
    store.addFavorite(makeModel('shared'), 'beta')
    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
    store.removeFavorite('shared', 'alpha')
    expect(store.isFavorite('shared', 'alpha')).toBe(false)
    expect(store.isFavorite('shared', 'beta')).toBe(true)
  })

  it('toggling a model on another provider does not unstar the first', () => {
    const store = useFavoriteModel.getState()
    store.toggleFavorite(makeModel('shared'), 'alpha')
    store.toggleFavorite(makeModel('shared'), 'beta')
    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
    store.toggleFavorite(makeModel('shared'), 'beta')
    expect(store.isFavorite('shared', 'alpha')).toBe(true)
    expect(store.isFavorite('shared', 'beta')).toBe(false)
  })

  it('does not remove another provider favorite when deleting a same-id model', () => {
    useFavoriteModel.setState({ favoriteModels: [
      { ...makeModel('shared'), provider: 'alpha' },
      { ...makeModel('shared'), provider: 'beta' },
    ] })
    useFavoriteModel.getState().removeFavorite('shared', 'alpha')
    expect(useFavoriteModel.getState().favoriteModels).toEqual([{ ...makeModel('shared'), provider: 'beta' }])
  })

  it('should add a favorite', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'llamacpp')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    expect(useFavoriteModel.getState().favoriteModels[0].id).toBe('model-1')
  })

  it('should not add duplicate favorites', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'llamacpp')
      useFavoriteModel.getState().addFavorite(model, 'llamacpp')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
  })

  it('should remove a favorite', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'llamacpp')
    })

    act(() => {
      useFavoriteModel.getState().removeFavorite('model-1', 'llamacpp')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(0)
  })

  it('should check isFavorite correctly', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'llamacpp')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'llamacpp')).toBe(true)
    expect(useFavoriteModel.getState().isFavorite('model-2', 'llamacpp')).toBe(false)
  })

  it('should toggle favorite on', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().toggleFavorite(model, 'llamacpp')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'llamacpp')).toBe(true)
  })

  it('should toggle favorite off', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'llamacpp')
    })

    act(() => {
      useFavoriteModel.getState().toggleFavorite(model, 'llamacpp')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'llamacpp')).toBe(false)
  })

  it('should handle multiple favorites', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite(makeModel('a'), 'llamacpp')
      useFavoriteModel.getState().addFavorite(makeModel('b'), 'llamacpp')
      useFavoriteModel.getState().addFavorite(makeModel('c'), 'llamacpp')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(3)

    act(() => {
      useFavoriteModel.getState().removeFavorite('b', 'llamacpp')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
    expect(useFavoriteModel.getState().isFavorite('b', 'llamacpp')).toBe(false)
  })
})
