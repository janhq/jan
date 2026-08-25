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

  it('should add a favorite', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    expect(useFavoriteModel.getState().favoriteModels[0]).toEqual({ modelId: 'model-1', provider: 'openai' })
  })

  it('should not add duplicate favorites (same model + provider)', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
  })

  it('should allow same model id from different providers', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
      useFavoriteModel.getState().addFavorite('model-1', 'huggingface')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
  })

  it('should remove a favorite by model id + provider', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
    })

    act(() => {
      useFavoriteModel.getState().removeFavorite('model-1', 'openai')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(0)
  })

  it('should only remove the matching provider when same model id exists in multiple providers', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
      useFavoriteModel.getState().addFavorite('model-1', 'huggingface')
    })

    act(() => {
      useFavoriteModel.getState().removeFavorite('model-1', 'openai')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    expect(useFavoriteModel.getState().favoriteModels[0]).toEqual({ modelId: 'model-1', provider: 'huggingface' })
  })

  it('should removeFavoritesForProvider - removes all models of a provider', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
      useFavoriteModel.getState().addFavorite('model-2', 'openai')
      useFavoriteModel.getState().addFavorite('model-3', 'anthropic')
    })

    act(() => {
      useFavoriteModel.getState().removeFavoritesForProvider('openai')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    expect(useFavoriteModel.getState().favoriteModels[0]).toEqual({ modelId: 'model-3', provider: 'anthropic' })
  })

  it('should check isFavorite correctly with provider', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'openai')).toBe(true)
    expect(useFavoriteModel.getState().isFavorite('model-1', 'anthropic')).toBe(false)
    expect(useFavoriteModel.getState().isFavorite('model-2', 'openai')).toBe(false)
  })

  it('should toggle favorite on', () => {
    act(() => {
      useFavoriteModel.getState().toggleFavorite('model-1', 'openai')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'openai')).toBe(true)
  })

  it('should toggle favorite off', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('model-1', 'openai')
    })

    act(() => {
      useFavoriteModel.getState().toggleFavorite('model-1', 'openai')
    })

    expect(useFavoriteModel.getState().isFavorite('model-1', 'openai')).toBe(false)
  })

  it('should handle multiple favorites', () => {
    act(() => {
      useFavoriteModel.getState().addFavorite('a', 'openai')
      useFavoriteModel.getState().addFavorite('b', 'openai')
      useFavoriteModel.getState().addFavorite('c', 'anthropic')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(3)

    act(() => {
      useFavoriteModel.getState().removeFavorite('b', 'openai')
    })

    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
    expect(useFavoriteModel.getState().isFavorite('b', 'openai')).toBe(false)
  })
})