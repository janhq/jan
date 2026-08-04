import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { ReactNode } from 'react'

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <span>{children}</span>,
}))
vi.mock('../shimmer', () => ({
  Shimmer: ({ children }: { children: ReactNode }) => (
    <span data-testid="shimmer">{children}</span>
  ),
}))
// Surface the interpolated duration, which the shared mock in
// chain-of-thought.test.tsx deliberately drops.
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      o?.duration !== undefined
        ? `${key}(${o.duration})`
        : o?.count !== undefined
          ? `${o.count}`
          : key,
  }),
}))

import { ChainOfThought, ChainOfThoughtHeader } from '../chain-of-thought'

const Trace = ({ streaming }: { streaming: boolean }) => (
  <ChainOfThought isStreaming={streaming}>
    <ChainOfThoughtHeader completedVariant="worked" />
  </ChainOfThought>
)

const label = () =>
  screen.getByText(/chat:reasoning/).textContent?.replace(/\s+/g, ' ')

const advanceTo = (ms: number) =>
  act(() => {
    vi.setSystemTime(ms)
  })

describe('ChainOfThought duration', () => {
  const start = () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  }
  afterEach(() => vi.useRealTimers())

  it('reports how long the trace ran', () => {
    start()
    const { rerender } = render(<Trace streaming />)
    advanceTo(1_005_000)
    rerender(<Trace streaming={false} />)
    expect(label()).toBe('chat:reasoning.workedFor(5)')
  })

  it('converts past a minute', () => {
    start()
    const { rerender } = render(<Trace streaming />)
    advanceTo(1_090_000)
    rerender(<Trace streaming={false} />)
    expect(label()).toBe('chat:reasoning.workedFor(1 30)')
  })

  // A reloaded thread never streamed in this session, so there is no measured
  // duration to report.
  it('says "a while" when it never streamed', () => {
    start()
    render(<Trace streaming={false} />)
    expect(label()).toBe('chat:reasoning.workedForAWhile')
  })

  // A trace that starts and finishes inside one tick measured 0s, and the
  // header treats 0 as "still going", so it shimmered "Thinking..." forever.
  it('does not get stuck shimmering when the trace finishes instantly', () => {
    start()
    const { rerender } = render(<Trace streaming />)
    rerender(<Trace streaming={false} />)
    expect(screen.queryByTestId('shimmer')).not.toBeInTheDocument()
    expect(label()).toBe('chat:reasoning.workedFor(1)')
  })

  // An agentic turn reasons, answers, then reasons again. Each window used to
  // overwrite the last, so the header reported only the final one.
  it('accumulates across every reasoning window in the turn', () => {
    start()
    const { rerender } = render(<Trace streaming />)
    advanceTo(1_010_000)
    rerender(<Trace streaming={false} />)
    expect(label()).toBe('chat:reasoning.workedFor(10)')

    rerender(<Trace streaming />)
    advanceTo(1_012_000)
    rerender(<Trace streaming={false} />)
    expect(label()).toBe('chat:reasoning.workedFor(12)')
  })

  it('keeps shimmering while the trace is still running', () => {
    start()
    render(<Trace streaming />)
    expect(screen.getByTestId('shimmer')).toBeInTheDocument()
  })
})
