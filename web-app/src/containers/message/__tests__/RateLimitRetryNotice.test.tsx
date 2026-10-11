import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}))

import { useRateLimitRetry, MAX_RATE_LIMIT_RETRIES } from '@/stores/rate-limit-retry-store'
import { RateLimitRetryNotice } from '../RateLimitRetryNotice'

describe('RateLimitRetryNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    useRateLimitRetry.setState({ reported: {}, attempts: {}, pending: {}, gaveUp: {} })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const schedule = (messageId: string, delayMs: number) =>
    act(() => {
      useRateLimitRetry.getState().report('t1', delayMs)
      useRateLimitRetry.getState().schedule('t1', messageId, Date.now())
    })

  it('counts down to the automatic retry', () => {
    schedule('m1', 30_000)
    render(<RateLimitRetryNotice messageId="m1" />)

    expect(
      screen.getByText(
        `model-errors:rateLimitRetrying ${JSON.stringify({ seconds: 30, attempt: 1, max: MAX_RATE_LIMIT_RETRIES })}`
      )
    ).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByText(/"seconds":20/)).toBeInTheDocument()
  })

  it('calls the retry off', () => {
    schedule('m1', 30_000)
    render(<RateLimitRetryNotice messageId="m1" />)

    fireEvent.click(screen.getByRole('button', { name: 'model-errors:rateLimitCancelRetry' }))

    expect(useRateLimitRetry.getState().pending.t1).toBeUndefined()
    expect(screen.queryByText(/rateLimitRetrying/)).not.toBeInTheDocument()
  })

  it('shows nothing for a message without a scheduled retry', () => {
    schedule('m1', 30_000)
    const { container } = render(<RateLimitRetryNotice messageId="m2" />)

    expect(container).toBeEmptyDOMElement()
  })
})
