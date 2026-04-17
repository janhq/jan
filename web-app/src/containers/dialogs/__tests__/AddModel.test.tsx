import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Mock hooks and components before importing component
const mockUpdateProvider = vi.fn()
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({ updateProvider: mockUpdateProvider }),
}))

vi.mock('@/hooks/useProviderModels', () => ({
  useProviderModels: () => ({
    models: ['gpt-4', 'gpt-3.5-turbo'],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/containers/ModelCombobox', () => ({
  ModelCombobox: (props: { placeholder?: string; value: string }) => (
    <div data-testid="model-combobox">{props.placeholder}</div>
  ),
}))

vi.mock('@/lib/utils', () => ({
  getProviderTitle: (p: string) => p,
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/lib/models', () => ({
  getModelCapabilities: () => ({ textCompletion: true }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { DialogAddModel } from '../AddModel'

const makeProvider = (overrides = {}): ModelProvider =>
  ({
    provider: 'openai',
    base_url: 'https://api.openai.com',
    models: [],
    explore_models_url: '',
    active: true,
    ...overrides,
  }) as unknown as ModelProvider

describe('DialogAddModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger button', () => {
    render(<DialogAddModel provider={makeProvider()} />)
    // Default trigger is a button with IconPlus
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders with a custom trigger', () => {
    render(
      <DialogAddModel
        provider={makeProvider()}
        trigger={<button>Custom Trigger</button>}
      />
    )
    expect(screen.getByText('Custom Trigger')).toBeInTheDocument()
  })
})
