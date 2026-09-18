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

  it('should add a favorite with provider scope', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'openrouter')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    expect(useFavoriteModel.getState().favoriteModels[0].id).toBe('model-1')
    expect(useFavoriteModel.getState().favoriteModels[0].provider).toBe(
      'openrouter'
    )
  })

  it('should not add duplicate favorites for the same provider', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'openrouter')
      useFavoriteModel.getState().addFavorite(model, 'openrouter')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
  })

  it('should allow the same model id under different providers', () => {
    const model = makeModel('gpt-4o')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'openrouter')
      useFavoriteModel.getState().addFavorite(model, 'huggingface')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
    expect(
      useFavoriteModel.getState().isFavorite('gpt-4o', 'openrouter')
    ).toBe(true)
    expect(
      useFavoriteModel.getState().isFavorite('gpt-4o', 'huggingface')
    ).toBe(true)
  })

  it('should remove a favorite for one provider only', () => {
    const model = makeModel('gpt-4o')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'openrouter')
      useFavoriteModel.getState().addFavorite(model, 'huggingface')
    })

    act(() => {
      useFavoriteModel.getState().removeFavorite('gpt-4o', 'openrouter')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    expect(
      useFavoriteModel.getState().isFavorite('gpt-4o', 'openrouter')
    ).toBe(false)
    expect(
      useFavoriteModel.getState().isFavorite('gpt-4o', 'huggingface')
    ).toBe(true)
  })

  it('should check isFavorite correctly', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'openrouter')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'openrouter')).toBe(
      true
    )
    expect(
      useFavoriteModel.getState().isFavorite('model-1', 'huggingface')
    ).toBe(false)
    expect(useFavoriteModel.getState().isFavorite('model-2', 'openrouter')).toBe(
      false
    )
  })

  it('should toggle favorite on', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().toggleFavorite(model, 'openrouter')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'openrouter')).toBe(
      true
    )
  })

  it('should toggle favorite off', () => {
    const model = makeModel('model-1')

    act(() => {
      useFavoriteModel.getState().addFavorite(model, 'openrouter')
    })

    act(() => {
      useFavoriteModel.getState().toggleFavorite(model, 'openrouter')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'openrouter')).toBe(
      false
    )
  })

  it('should handle multiple favorites', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite(makeModel('a'), 'p1')
      useFavoriteModel.getState().addFavorite(makeModel('b'), 'p1')
      useFavoriteModel.getState().addFavorite(makeModel('c'), 'p2')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(3)

    act(() => {
      useFavoriteModel.getState().removeFavorite('b', 'p1')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
    expect(useFavoriteModel.getState().isFavorite('b', 'p1')).toBe(false)
  })
})
