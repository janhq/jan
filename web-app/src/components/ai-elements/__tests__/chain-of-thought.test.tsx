import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtText,
  ChainOfThoughtStep,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
  ChainOfThoughtImage,
  useChainOfThought,
} from '../chain-of-thought'

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <span>{children}</span>,
}))

vi.mock('../shimmer', () => ({
  Shimmer: ({ children }: { children: ReactNode }) => (
    <span data-testid="shimmer">{children}</span>
  ),
}))

describe('ChainOfThought', () => {
  it('renders children inside a Collapsible, defaults open', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <p>Inner content</p>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.getByText('Inner content')).toBeInTheDocument()
  })

  it('defaults to open state', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <p>Visible</p>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.getByText('Visible')).toBeVisible()
  })

  it('can start closed with defaultOpen=false', () => {
    render(
      <ChainOfThought defaultOpen={false}>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <p>Hidden content</p>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument()
  })

  it('auto-collapses when shouldCollapse becomes true', () => {
    const { rerender } = render(
      <ChainOfThought shouldCollapse={false}>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <p>Content here</p>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.getByText('Content here')).toBeInTheDocument()

    rerender(
      <ChainOfThought shouldCollapse={true}>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <p>Content here</p>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.queryByText('Content here')).not.toBeInTheDocument()
  })

  it('calls onOpenChange when toggled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <ChainOfThought onOpenChange={onOpenChange}>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <p>Content</p>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    await user.click(screen.getByRole('button'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('ChainOfThoughtHeader', () => {
  it('shows "Reasoning..." shimmer when isStreaming=true', () => {
    render(
      <ChainOfThought isStreaming={true}>
        <ChainOfThoughtHeader />
      </ChainOfThought>
    )
    expect(screen.getByTestId('shimmer')).toBeInTheDocument()
    expect(screen.getByText('Reasoning...')).toBeInTheDocument()
  })

  it('shows title when provided and not streaming', () => {
    render(
      <ChainOfThought isStreaming={false}>
        <ChainOfThoughtHeader title="Analyzing code" />
      </ChainOfThought>
    )
    expect(screen.getByText('Analyzing code')).toBeInTheDocument()
    expect(screen.queryByTestId('shimmer')).not.toBeInTheDocument()
  })

  it('shows default text when no title and not streaming', () => {
    render(
      <ChainOfThought isStreaming={false}>
        <ChainOfThoughtHeader />
      </ChainOfThought>
    )
    expect(
      screen.getByText('Reasoned through the problem')
    ).toBeInTheDocument()
  })

  it('renders custom children instead of default content', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader>
          <span>Custom header</span>
        </ChainOfThoughtHeader>
      </ChainOfThought>
    )
    expect(screen.getByText('Custom header')).toBeInTheDocument()
    expect(
      screen.queryByText('Reasoned through the problem')
    ).not.toBeInTheDocument()
  })
})

describe('ChainOfThoughtContent', () => {
  it('renders children inside CollapsibleContent', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <p>Step details</p>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.getByText('Step details')).toBeInTheDocument()
  })
})

describe('ChainOfThoughtText', () => {
  it('renders text through Streamdown', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader />
        <ChainOfThoughtText>Some reasoning text</ChainOfThoughtText>
      </ChainOfThought>
    )
    expect(screen.getByText('Some reasoning text')).toBeInTheDocument()
  })
})

describe('ChainOfThoughtStep', () => {
  it.each([
    ['complete', 'check-circle-2'],
    ['active', 'circle-dot'],
    ['pending', 'circle'],
  ] as const)('renders with status=%s', (status) => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <ChainOfThoughtStep status={status} label={`Step ${status}`} />
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.getByText(`Step ${status}`)).toBeInTheDocument()
  })

  it('renders children below the label', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <ChainOfThoughtStep status="complete" label="Done">
            <p>Extra info</p>
          </ChainOfThoughtStep>
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.getByText('Extra info')).toBeInTheDocument()
  })

  it('renders custom icon when provided', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <ChainOfThoughtStep
            status="complete"
            label="Custom"
            icon={<span data-testid="custom-icon">★</span>}
          />
        </ChainOfThoughtContent>
      </ChainOfThought>
    )
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })
})

describe('ChainOfThoughtSearchResults', () => {
  it('renders title and children', () => {
    render(
      <ChainOfThoughtSearchResults title="Sources">
        <span>result-1</span>
      </ChainOfThoughtSearchResults>
    )
    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('result-1')).toBeInTheDocument()
  })

  it('omits title element when no title prop', () => {
    const { container } = render(
      <ChainOfThoughtSearchResults>
        <span>result</span>
      </ChainOfThoughtSearchResults>
    )
    expect(container.querySelector('h4')).toBeNull()
  })
})

describe('ChainOfThoughtSearchResult', () => {
  it('renders as a link with href and target="_blank"', () => {
    render(
      <ChainOfThoughtSearchResult href="https://example.com">
        Example
      </ChainOfThoughtSearchResult>
    )
    const link = screen.getByRole('link', { name: /Example/ })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('ChainOfThoughtImage', () => {
  it('renders children', () => {
    render(
      <ChainOfThoughtImage>
        <img src="test.png" alt="test" />
      </ChainOfThoughtImage>
    )
    expect(screen.getByAltText('test')).toBeInTheDocument()
  })

  it('renders caption in figcaption when provided', () => {
    render(
      <ChainOfThoughtImage caption="A diagram">
        <img src="test.png" alt="test" />
      </ChainOfThoughtImage>
    )
    expect(screen.getByText('A diagram')).toBeInTheDocument()
    expect(screen.getByText('A diagram').tagName).toBe('FIGCAPTION')
  })

  it('omits figcaption when no caption', () => {
    const { container } = render(
      <ChainOfThoughtImage>
        <img src="test.png" alt="test" />
      </ChainOfThoughtImage>
    )
    expect(container.querySelector('figcaption')).toBeNull()
  })
})

describe('useChainOfThought', () => {
  it('throws when used outside ChainOfThought', () => {
    // Suppress console.error from React for the expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => {
      renderHook(() => useChainOfThought())
    }).toThrow('ChainOfThought components must be used within ChainOfThought')
    spy.mockRestore()
  })

  it('returns context values when used inside ChainOfThought', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChainOfThought isStreaming={true}>{children}</ChainOfThought>
    )
    const { result } = renderHook(() => useChainOfThought(), { wrapper })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.isOpen).toBe(true)
    expect(typeof result.current.setIsOpen).toBe('function')
  })
})
