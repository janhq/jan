import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockToggleFavorite = vi.fn()
const mockIsFavorite = vi.fn().mockReturnValue(false)
vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: () => ({
    isFavorite: mockIsFavorite,
    toggleFavorite: mockToggleFavorite,
  }),
}))

import { FavoriteModelAction } from '../FavoriteModelAction'

const model: Model = { id: 'test-model' }

describe('FavoriteModelAction', () => {
  it('renders toggle button', () => {
    render(<FavoriteModelAction model={model} />)
    expect(screen.getByLabelText('Toggle favorite')).toBeDefined()
  })

  it('calls toggleFavorite on click', () => {
    render(<FavoriteModelAction model={model} />)
    fireEvent.click(screen.getByLabelText('Toggle favorite'))
    expect(mockToggleFavorite).toHaveBeenCalledWith(model)
  })
})
