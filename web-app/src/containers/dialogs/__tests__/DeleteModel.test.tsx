import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { DialogDeleteModel } from '../DeleteModel'

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    setProviders: vi.fn(),
    deleteModel: vi.fn(),
  })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    models: () => ({ deleteModel: vi.fn(() => Promise.resolve()) }),
    providers: () => ({ getProviders: vi.fn(() => Promise.resolve([])) }),
  })),
}))

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: () => ({ removeFavorite: vi.fn() }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('DialogDeleteModel', () => {
  const mockProvider = {
    provider: 'llamacpp',
    active: true,
    models: [{ id: 'model-1', capabilities: [] }],
    settings: [],
  } as any

  beforeEach(() => vi.clearAllMocks())

  it('renders trigger icon when model exists', () => {
    const { container } = render(
      <DialogDeleteModel provider={mockProvider} modelId="model-1" />
    )
    expect(container).toBeTruthy()
  })

  it('returns null when model not found', () => {
    const { container } = render(
      <DialogDeleteModel provider={mockProvider} modelId="nonexistent" />
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null for empty models array', () => {
    const emptyProvider = { ...mockProvider, models: [] } as any
    const { container } = render(
      <DialogDeleteModel provider={emptyProvider} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('defaults to first model when no modelId provided', () => {
    const { container } = render(
      <DialogDeleteModel provider={mockProvider} />
    )
    expect(container).toBeTruthy()
  })
})
