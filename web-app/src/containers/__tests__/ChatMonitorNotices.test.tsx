import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.headline ? `${key}:${options.headline}` : key,
  }),
}))
// Dismiss must never reach orchestration (inference run / model inbox drain).
const chatRunInbox = vi.hoisted(() => vi.fn())
vi.mock('@/lib/chatOrchestration', () => ({ chatRunInbox }))

import { ChatMonitorNotices } from '../ChatMonitorNotices'
import { useMonitorNotices } from '@/stores/monitor-notice-store'

const publish = (threadId: string, monitorId = 'm1', headline = 'done', text = 'all good') =>
  act(() => useMonitorNotices.getState().publish({ threadId, monitorId, headline, text }))

const reset = () => {
  cleanup()
  act(() => useMonitorNotices.setState({ byThread: {} }))
  chatRunInbox.mockClear()
}

describe('ChatMonitorNotices', () => {
  beforeEach(reset)
  afterEach(reset)

  it('renders nothing while the store is idle', () => {
    render(<ChatMonitorNotices threadId="t1" />)
    expect(screen.queryByTestId('chat-monitor-notices')).toBeNull()
  })

  it('shows a notice published through the real store for its own thread', () => {
    render(<ChatMonitorNotices threadId="t1" />)
    publish('t1')
    expect(screen.getByTestId('chat-monitor-notices')).toBeInTheDocument()
    expect(screen.getByText('common:monitorFinishedWithHeadline:done')).toBeInTheDocument()
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('uses the headline-less label when there is no headline', () => {
    render(<ChatMonitorNotices threadId="t1" />)
    publish('t1', 'm1', '', 'detail only')
    expect(screen.getByText('common:monitorFinished')).toBeInTheDocument()
  })

  it('does not show a notice from another thread, even with the same monitor ID', () => {
    render(<ChatMonitorNotices threadId="t2" />)
    publish('t1', 'same-monitor')
    expect(screen.queryByTestId('chat-monitor-notices')).toBeNull()
    publish('t2', 'same-monitor', 'other', 'mine')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByText('mine')).toBeInTheDocument()
    expect(screen.queryByText('all good')).toBeNull()
  })

  it('dismiss hides only that row and does not call inference or drain the model inbox', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<ChatMonitorNotices threadId="t1" />)
    publish('t1', 'a', 'first', 'one')
    publish('t1', 'b', 'second', 'two')
    expect(screen.getAllByRole('status')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'common:dismissMonitorNotice' })[0])
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.queryByText('one')).toBeNull()
    expect(screen.getByText('two')).toBeInTheDocument()
    expect(chatRunInbox).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('dismiss button is keyboard focusable with a visible focus ring', () => {
    render(<ChatMonitorNotices threadId="t1" />)
    publish('t1')
    const button = screen.getByRole('button', { name: 'common:dismissMonitorNotice' })
    button.focus()
    expect(button).toHaveFocus()
    expect(button.className).toContain('focus-visible:ring-2')
  })
})
