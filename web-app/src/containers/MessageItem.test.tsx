import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MessageItem } from './MessageItem'
import type { UIMessage } from 'ai'
import type { SubagentRun } from '@/types/coworkSession'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({}),
}))

describe('agent activity status', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 1, 0, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const pendingWrite: UIMessage = {
    id: 'm1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-write',
        toolCallId: 'c1',
        state: 'input-available',
        input: { path: '/proj/report.html' },
      } as never,
    ],
  } as UIMessage

  /// The call's own card sits one row above with its name, arguments and a
  /// ticking duration, so a status row saying "Writing report.html" printed the
  /// same thing twice.
  it('leaves a pending tool call to its own card', () => {
    render(
      <MessageItem
        message={pendingWrite}
        isFirstMessage={false}
        isLastMessage={true}
        status="streaming"
      />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  /// A subagent is the exception: it works in a lane of its own, so nothing in
  /// this turn reports it and the row is the only place it shows.
  it('reports a running subagent, and ticks its elapsed time', () => {
    const subagents: SubagentRun[] = [
      {
        runId: 'r1',
        name: 'researcher',
        status: 'running',
        startedAt: Date.now(),
        turns: [],
      },
    ]
    render(
      <MessageItem
        message={pendingWrite}
        isFirstMessage={false}
        isLastMessage={true}
        status="streaming"
        subagents={subagents}
      />
    )
    expect(screen.getByText(/researcher: working/)).toBeInTheDocument()
    expect(screen.getByText(/0ms/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/3s/)).toBeInTheDocument()
  })

  it('drops the row once the subagent finishes', () => {
    const subagents: SubagentRun[] = [
      {
        runId: 'r1',
        name: 'researcher',
        status: 'done',
        startedAt: Date.now(),
        turns: [],
      },
    ]
    render(
      <MessageItem
        message={pendingWrite}
        isFirstMessage={false}
        isLastMessage={true}
        status="streaming"
        subagents={subagents}
      />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
