import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  useReasoning,
} from '../reasoning'

const streamdown = vi.hoisted(() => ({
  components: undefined as
    | Record<string, (props: Record<string, unknown>) => ReactNode>
    | undefined,
}))
vi.mock('streamdown', () => ({
  Streamdown: ({
    children,
    components,
  }: {
    children: string
    components?: typeof streamdown.components
  }) => {
    streamdown.components = components
    return <span>{children}</span>
  },
}))

const openExternalUrl = vi.hoisted(() => vi.fn())
vi.mock('@/lib/externalLink', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/externalLink')>()),
  openExternalUrl,
}))

vi.mock('../shimmer', () => ({
  Shimmer: ({ children }: { children: ReactNode }) => (
    <span data-testid="shimmer">{children}</span>
  ),
}))

describe('Reasoning', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders children inside a Collapsible and defaults to open', () => {
    render(
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>Some reasoning text</ReasoningContent>
      </Reasoning>
    )

    expect(screen.getByText('Some reasoning text')).toBeInTheDocument()
  })

  it('shows "Thinking..." shimmer when isStreaming=true', () => {
    render(
      <Reasoning isStreaming>
        <ReasoningTrigger />
      </Reasoning>
    )

    expect(screen.getByTestId('shimmer')).toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('shows "Thought for X seconds" when not streaming and duration is set', () => {
    render(
      <Reasoning isStreaming={false} duration={5}>
        <ReasoningTrigger />
      </Reasoning>
    )

    expect(screen.getByText('Thought for 5 seconds')).toBeInTheDocument()
  })

  it('shows "Thought for a few seconds" when duration is undefined and not streaming', () => {
    render(
      <Reasoning isStreaming={false}>
        <ReasoningTrigger />
      </Reasoning>
    )

    expect(
      screen.getByText('Thought for a few seconds')
    ).toBeInTheDocument()
  })

  it('calculates duration when isStreaming transitions from true to false', () => {
    const { rerender } = render(
      <Reasoning isStreaming>
        <ReasoningTrigger />
      </Reasoning>
    )

    // Advance time by 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    rerender(
      <Reasoning isStreaming={false}>
        <ReasoningTrigger />
      </Reasoning>
    )

    expect(screen.getByText('Thought for 3 seconds')).toBeInTheDocument()
  })

  it('ceils duration to next second', () => {
    const { rerender } = render(
      <Reasoning isStreaming>
        <ReasoningTrigger />
      </Reasoning>
    )

    act(() => {
      vi.advanceTimersByTime(2100)
    })

    rerender(
      <Reasoning isStreaming={false}>
        <ReasoningTrigger />
      </Reasoning>
    )

    expect(screen.getByText('Thought for 3 seconds')).toBeInTheDocument()
  })

  it('calls custom getThinkingMessage with correct args', () => {
    const getThinkingMessage = vi.fn(
      (isStreaming: boolean, duration?: number) => (
        <span>
          custom-{String(isStreaming)}-{String(duration)}
        </span>
      )
    )

    render(
      <Reasoning isStreaming={false} duration={10}>
        <ReasoningTrigger getThinkingMessage={getThinkingMessage} />
      </Reasoning>
    )

    expect(getThinkingMessage).toHaveBeenCalledWith(false, 10)
    expect(screen.getByText('custom-false-10')).toBeInTheDocument()
  })

  it('supports controlled open/onOpenChange', () => {
    const onOpenChange = vi.fn()

    const { rerender } = render(
      <Reasoning open={true} onOpenChange={onOpenChange}>
        <ReasoningTrigger />
        <ReasoningContent>Content here</ReasoningContent>
      </Reasoning>
    )

    expect(screen.getByText('Content here')).toBeInTheDocument()

    rerender(
      <Reasoning open={false} onOpenChange={onOpenChange}>
        <ReasoningTrigger />
        <ReasoningContent>Content here</ReasoningContent>
      </Reasoning>
    )

    expect(screen.queryByText('Content here')).not.toBeInTheDocument()
  })

  it('renders ReasoningContent with text children', () => {
    render(
      <Reasoning>
        <ReasoningContent>Hello reasoning world</ReasoningContent>
      </Reasoning>
    )

    expect(screen.getByText('Hello reasoning world')).toBeInTheDocument()
  })
})

describe('useReasoning', () => {
  it('throws when used outside Reasoning', () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useReasoning())
    }).toThrow('Reasoning components must be used within Reasoning')

    spy.mockRestore()
  })

  it('returns context values when used inside Reasoning', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Reasoning isStreaming duration={7}>
        {children}
      </Reasoning>
    )

    const { result } = renderHook(() => useReasoning(), { wrapper })

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.duration).toBe(7)
    expect(result.current.isOpen).toBe(true)
    expect(typeof result.current.setIsOpen).toBe('function')
  })
})

describe('ReasoningContent links', () => {
  const renderLink = (href: string) => {
    render(
      <Reasoning>
        <ReasoningContent>see the docs</ReasoningContent>
      </Reasoning>
    )
    const A = streamdown.components!.a
    render(<A href={href}>docs</A>)
    return screen.getByText('docs')
  }

  it('opens a web link outside the app', () => {
    openExternalUrl.mockClear()
    const link = renderLink('https://jan.ai/docs')
    expect(link).toHaveAttribute('href', 'https://jan.ai/docs')
    expect(link).not.toHaveAttribute('target')
    act(() => link.click())
    expect(openExternalUrl).toHaveBeenCalledTimes(1)
    expect(openExternalUrl).toHaveBeenCalledWith('https://jan.ai/docs')
  })

  it('renders any other link as inert text', () => {
    openExternalUrl.mockClear()
    const link = renderLink('javascript:alert(1)')
    expect(link).not.toHaveAttribute('href')
    act(() => link.click())
    expect(openExternalUrl).not.toHaveBeenCalled()
  })
})
