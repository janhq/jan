import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      `${key}:${options?.count ?? ''}`,
  }),
}))

import { ToolElapsed } from '../tool-runtime'

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
