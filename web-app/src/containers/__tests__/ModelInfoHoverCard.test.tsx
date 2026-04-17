import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: any) => <div data-testid="hover-card">{children}</div>,
  HoverCardContent: ({ children }: any) => <div data-testid="hover-card-content">{children}</div>,
  HoverCardTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@tabler/icons-react', () => ({ IconInfoCircle: (p: any) => <span data-testid="info-icon" /> }))

import { ModelInfoHoverCard } from '../ModelInfoHoverCard'

describe('ModelInfoHoverCard', () => {
  const baseProps = {
    model: { model_name: 'test-model', quants: [{ model_id: 'test-q4_k_m', file_size: '2GB' }] } as any,
    variant: { model_id: 'test-q4_k_m', file_size: '2GB' } as any,
    defaultModelQuantizations: ['q4_k_m'],
    modelSupportStatus: {},
    onCheckModelSupport: vi.fn(),
  }

  it('renders hover card with info icon', () => {
    render(<ModelInfoHoverCard {...baseProps} />)
    expect(screen.getByTestId('hover-card')).toBeInTheDocument()
    expect(screen.getByTestId('info-icon')).toBeInTheDocument()
  })

  it('renders model name in content', () => {
    render(<ModelInfoHoverCard {...baseProps} isDefaultVariant={true} />)
    expect(screen.getByText('test-model')).toBeInTheDocument()
  })

  it('renders null for MLX models', () => {
    const { container } = render(
      <ModelInfoHoverCard {...baseProps} model={{ ...baseProps.model, is_mlx: true }} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders GREEN compatibility status', () => {
    render(<ModelInfoHoverCard {...baseProps} modelSupportStatus={{ 'test-q4_k_m': 'GREEN' }} />)
    expect(screen.getByText('Recommended for your device')).toBeInTheDocument()
  })
})
