import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ThreadMessage } from '@janhq/core'

const service = vi.hoisted(() => ({
  createMessage: vi.fn(),
  modifyMessage: vi.fn(),
  deleteMessage: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ messages: () => service }),
}))
const sonner = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: sonner }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  i18n: { t: (key: string) => key },
}))

import {
  useMessages,
  flushMessageWrites,
  forgetMessageWrites,
  __resetMessageWritesForTests,
} from '../useMessages'

const message = (id: string, threadId = 't1') =>
  ({ id, thread_id: threadId, role: 'user', content: 'x', created_at: 1 }) as unknown as ThreadMessage

describe('useMessages write persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetMessageWritesForTests()
    vi.clearAllMocks()
    useMessages.setState({ messages: {} })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries a failed head with backoff, in order, and clears the toast on recovery', async () => {
    const written: string[] = []
    let failures = 2
    service.createMessage.mockImplementation(async (m: { id: string }) => {
      if (m.id === 'a' && failures-- > 0) throw new Error('disk full')
      written.push(m.id)
    })
    useMessages.getState().addMessage(message('a'))
    useMessages.getState().addMessage(message('b'))
    await vi.advanceTimersByTimeAsync(0)
    expect(written).toEqual([])
    expect(sonner.error).toHaveBeenCalledWith(
      'common:messageWrites.failedTitle',
      expect.objectContaining({ id: 'message-writes-failed' })
    )

    await vi.runAllTimersAsync()
    expect(written).toEqual(['a', 'b'])
    expect(sonner.dismiss).toHaveBeenCalledWith('message-writes-failed')
  })

  it('stops the timer after the bounded attempts and retries on the next enqueue', async () => {
    let healthy = false
    const written: string[] = []
    service.createMessage.mockImplementation(async (m: { id: string }) => {
      if (!healthy) throw new Error('io')
      written.push(m.id)
    })
    useMessages.getState().addMessage(message('a'))
    await vi.advanceTimersByTimeAsync(0)
    // runAllTimersAsync aborts on an endless timer chain, so this also proves the bound.
    await vi.runAllTimersAsync()
    const attempts = service.createMessage.mock.calls.length
    expect(attempts).toBeGreaterThan(1)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(service.createMessage).toHaveBeenCalledTimes(attempts)

    healthy = true
    useMessages.getState().addMessage(message('b'))
    await vi.advanceTimersByTimeAsync(0)
    expect(written).toEqual(['a', 'b'])
    expect(sonner.dismiss).toHaveBeenCalledWith('message-writes-failed')
  })

  it('keeps the toast while another thread is still failing', async () => {
    service.createMessage.mockImplementation(async (m: { thread_id: string }) => {
      if (m.thread_id === 'bad') throw new Error('io')
    })
    useMessages.getState().addMessage(message('a', 'bad'))
    useMessages.getState().addMessage(message('b', 'good'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sonner.dismiss).not.toHaveBeenCalled()
  })

  it('still rejects an explicit flush for a persistent failure', async () => {
    service.createMessage.mockRejectedValue(new Error('io'))
    useMessages.getState().addMessage(message('a'))
    await expect(flushMessageWrites()).rejects.toThrow('io')
  })

  it('drops a deleted thread queue, its pending jobs, its timer and its toast', async () => {
    service.createMessage.mockRejectedValue(new Error('io'))
    useMessages.getState().addMessage(message('a'))
    await vi.advanceTimersByTimeAsync(0)
    const attempts = service.createMessage.mock.calls.length

    forgetMessageWrites('t1')
    expect(sonner.dismiss).toHaveBeenCalledWith('message-writes-failed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(service.createMessage).toHaveBeenCalledTimes(attempts)
    await expect(flushMessageWrites()).resolves.toBeUndefined()
  })
})
