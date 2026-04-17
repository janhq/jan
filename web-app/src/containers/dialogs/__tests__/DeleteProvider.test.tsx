import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DeleteProvider from '../DeleteProvider'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockDeleteProvider = vi.fn()

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    deleteProvider: mockDeleteProvider,
    providers: [{ provider: 'openai' }],
  }),
}))

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: () => ({
    favoriteModels: [],
    removeFavorite: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}))

vi.mock('@janhq/core', () => ({
  EngineManager: {
    instance: () => ({
      get: () => undefined,
    }),
  },
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: [{ provider: 'openai' }, { provider: 'anthropic' }],
}))

vi.mock('@/constants/routes', () => ({
  route: { settings: { providers: '/settings/providers/$providerName' } },
}))

vi.mock('@/containers/Card', () => ({
  CardItem: ({ title, description, actions }: { title: string; description: string; actions: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      <div>{actions}</div>
    </div>
  ),
}))

describe('DeleteProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for predefined provider', () => {
    const provider = {
      provider: 'openai',
      models: [],
    } as unknown as ProviderObject
    const { container } = render(<DeleteProvider provider={provider} />)
    expect(container.innerHTML).toBe('')
  })

  it('returns null when no provider', () => {
    const { container } = render(<DeleteProvider />)
    expect(container.innerHTML).toBe('')
  })

  it('renders for custom provider', () => {
    const provider = {
      provider: 'custom-provider',
      models: [],
    } as unknown as ProviderObject
    render(<DeleteProvider provider={provider} />)
    expect(screen.getByText('providers:deleteProvider.title')).toBeInTheDocument()
    expect(screen.getByText('providers:deleteProvider.description')).toBeInTheDocument()
  })

  it('renders delete button for custom provider', () => {
    const provider = {
      provider: 'custom-provider',
      models: [],
    } as unknown as ProviderObject
    render(<DeleteProvider provider={provider} />)
    expect(screen.getByText('providers:deleteProvider.delete')).toBeInTheDocument()
  })
})
