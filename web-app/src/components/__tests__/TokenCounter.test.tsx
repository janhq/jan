import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokenCounter } from '../TokenCounter'
import { useTokensCount } from '@/hooks/useTokensCount'
vi.mock('@/hooks/useTokensCount', () => ({
  useTokensCount: vi.fn(),
}))

// Mock tooltip components to render inline (Radix Portal + closed state prevents content from appearing in jsdom)
vi.mock('@/components/ui/tooltip', async () => {
  const React = await import('react')
  return {
    TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: React.forwardRef(({ children, asChild, ...props }: any, ref: any) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement, { ...props, ref })
      }
      return <span {...props} ref={ref}>{children}</span>
    }),
    TooltipContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="tooltip-content">{children}</div>
    ),
  }
})

const mockUseTokensCount = vi.mocked(useTokensCount)

function mockTokens(overrides: Partial<ReturnType<typeof useTokensCount>> = {}) {
  const defaults = {
    tokenCount: 0,
    maxTokens: 1000,
    calculateTokens: vi.fn(),
    ...overrides,
  }
  mockUseTokensCount.mockReturnValue(defaults)
  return defaults
}

describe('TokenCounter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTokens()
  })

  it('renders 0.0% when no messages and zero tokens', () => {
    render(<TokenCounter />)
    expect(screen.getAllByText('0.0%').length).toBeGreaterThanOrEqual(1)
  })

  it('renders correct percentage based on token count / max tokens', () => {
    mockTokens({ tokenCount: 500, maxTokens: 1000 })
    render(<TokenCounter />)
    expect(screen.getAllByText('50.0%').length).toBeGreaterThanOrEqual(1)
  })

  it('renders percentage with additionalTokens included', () => {
    mockTokens({ tokenCount: 200, maxTokens: 1000 })
    render(<TokenCounter additionalTokens={300} />)
    expect(screen.getAllByText('50.0%').length).toBeGreaterThanOrEqual(1)
  })

  it('applies destructive styling when over limit (>100%)', () => {
    mockTokens({ tokenCount: 1500, maxTokens: 1000 })
    render(<TokenCounter />)
    const percentElements = screen.getAllByText('150.0%')
    expect(percentElements.length).toBeGreaterThanOrEqual(1)
    const span = percentElements[0]
    expect(span.className).toContain('text-destructive')
  })

  it('applies primary styling when under limit', () => {
    mockTokens({ tokenCount: 500, maxTokens: 1000 })
    render(<TokenCounter />)
    const percentElements = screen.getAllByText('50.0%')
    const span = percentElements[0]
    expect(span.className).toContain('text-primary')
    expect(span.className).not.toContain('text-destructive')
  })

  it('calls calculateTokens when clicked', async () => {
    const user = userEvent.setup()
    const mocks = mockTokens({ tokenCount: 500, maxTokens: 1000 })
    const { container } = render(<TokenCounter />)
    const clickable = container.querySelector('.cursor-pointer')!
    await user.click(clickable)
    expect(mocks.calculateTokens).toHaveBeenCalledTimes(1)
  })

  it('renders the SVG progress ring', () => {
    mockTokens({ tokenCount: 500, maxTokens: 1000 })
    const { container } = render(<TokenCounter />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(2)
  })

  it('shows 0.0% when maxTokens is 0 (no model selected)', () => {
    mockTokens({ tokenCount: 0, maxTokens: 0 })
    render(<TokenCounter />)
    expect(screen.getAllByText('0.0%').length).toBeGreaterThanOrEqual(1)
  })

  describe('formatNumber helper (via rendered output)', () => {
    it('formats thousands as K', () => {
      mockTokens({ tokenCount: 1000, maxTokens: 2000 })
      const { container } = render(<TokenCounter />)
      expect(container.textContent).toContain('1.0K')
    })

    it('formats millions as M', () => {
      mockTokens({ tokenCount: 1000000, maxTokens: 2000000 })
      const { container } = render(<TokenCounter />)
      expect(container.textContent).toContain('1.0M')
    })

    it('shows raw number below 1000', () => {
      mockTokens({ tokenCount: 500, maxTokens: 1000 })
      const { container } = render(<TokenCounter />)
      expect(container.textContent).toContain('500')
    })
  })

  it('shows token breakdown with Text and Remaining labels', () => {
    mockTokens({ tokenCount: 500, maxTokens: 1000 })
    const { container } = render(<TokenCounter />)
    const tooltipContent = screen.getByTestId('tooltip-content')
    expect(tooltipContent.textContent).toContain('Text')
    expect(tooltipContent.textContent).toContain('Remaining')
  })

  it('shows correct remaining tokens', () => {
    mockTokens({ tokenCount: 300, maxTokens: 1000 })
    const { container } = render(<TokenCounter />)
    const tooltipContent = screen.getByTestId('tooltip-content')
    expect(tooltipContent.textContent).toContain('700')
  })

  it('shows 0 remaining when over limit', () => {
    mockTokens({ tokenCount: 1500, maxTokens: 1000 })
    const { container } = render(<TokenCounter />)
    const tooltipContent = screen.getByTestId('tooltip-content')
    expect(tooltipContent.textContent).toContain('Remaining')
    expect(tooltipContent.textContent).toMatch(/Remaining\s*0/)
  })

  it('accepts className prop', () => {
    mockTokens({ tokenCount: 0, maxTokens: 1000 })
    const { container } = render(<TokenCounter className="custom-class" />)
    const wrapper = container.querySelector('.custom-class')
    expect(wrapper).toBeTruthy()
  })
})
