import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MessageItem } from './MessageItem'
import type { UIMessage } from 'ai'

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

  const baseMessage: UIMessage = {
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

  it('shows the active tool label and ticks elapsed time', () => {
    render(
      <MessageItem
        message={baseMessage}
        isFirstMessage={false}
        isLastMessage={true}
        status="streaming"
      />
    )
    expect(screen.getByText(/Writing report\.html/)).toBeInTheDocument()
    expect(screen.getByText(/0ms/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/3s/)).toBeInTheDocument()
  })

  it('removes the status row once the tool result lands', () => {
    const doneMessage: UIMessage = {
      ...baseMessage,
      parts: [
        {
          type: 'tool-write',
          toolCallId: 'c1',
          state: 'output-available',
          input: { path: '/proj/report.html' },
          output: 'ok',
        } as never,
      ],
    } as UIMessage

    render(
      <MessageItem
        message={doneMessage}
        isFirstMessage={false}
        isLastMessage={true}
        status="ready"
      />
    )
    expect(screen.queryByText(/Writing report\.html/)).not.toBeInTheDocument()
  })
})
