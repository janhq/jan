import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      `${key}:${options?.count ?? ''}`,
  }),
}))

import { ToolElapsed, ToolProgressRow } from '../tool-runtime'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'

describe('ToolProgressRow', () => {
  beforeEach(() => {
    useToolCallRuntime.getState().reset()
  })

  const start = (id: string) => {
    const runtime = useToolCallRuntime.getState()
    runtime.enqueue([id])
    runtime.markRunning(id)
  }

  it('renders nothing until the server reports progress', () => {
    start('tc1')
    const { container } = render(<ToolProgressRow toolCallId="tc1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the message the server sent', () => {
    start('tc1')
    useToolCallRuntime
      .getState()
      .reportProgress({ server: 's', progress: 1, message: 'Indexing repo' })
    render(<ToolProgressRow toolCallId="tc1" />)
    expect(screen.getByText('Indexing repo')).toBeInTheDocument()
  })

  it('fills the bar to the reported percentage', () => {
    start('tc1')
    useToolCallRuntime
      .getState()
      .reportProgress({ server: 's', progress: 3, total: 4, percent: 75 })
    render(<ToolProgressRow toolCallId="tc1" />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '75')
    expect(bar.querySelector('div')).toHaveStyle({ width: '75%' })
  })

  // Servers may report progress with no total; a bar would imply a completion
  // fraction nobody sent.
  it('reports the count instead of a bar when there is no total', () => {
    start('tc1')
    useToolCallRuntime
      .getState()
      .reportProgress({ server: 's', progress: 12 })
    render(<ToolProgressRow toolCallId="tc1" />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('renders nothing once the call settles', () => {
    start('tc1')
    useToolCallRuntime
      .getState()
      .reportProgress({ server: 's', progress: 1, message: 'Indexing repo' })
    useToolCallRuntime.getState().markSettled('tc1')
    const { container } = render(<ToolProgressRow toolCallId="tc1" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ToolElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('renders nothing before the call starts', () => {
    const { container } = render(<ToolElapsed />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the final duration of a settled call', () => {
    render(<ToolElapsed startedAt={1_000_000} endedAt={1_012_000} />)
    expect(screen.getByText('common:duration.seconds:12')).toBeInTheDocument()
  })

  it('counts up while the call is running', () => {
    render(<ToolElapsed startedAt={1_000_000} />)
    expect(screen.getByText('common:duration.seconds:0')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('common:duration.seconds:3')).toBeInTheDocument()
  })

  it('stops counting once the call settles', () => {
    const { rerender } = render(<ToolElapsed startedAt={1_000_000} />)
    rerender(<ToolElapsed startedAt={1_000_000} endedAt={1_002_000} />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('common:duration.seconds:2')).toBeInTheDocument()
  })

  // "Used foo 0s" is noise; a sub-second call just has no duration worth showing.
  it('omits a duration that rounds to zero', () => {
    const { container } = render(
      <ToolElapsed startedAt={1_000_000} endedAt={1_000_400} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
