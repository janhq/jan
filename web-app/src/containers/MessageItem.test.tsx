import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageItem } from './MessageItem'
import type { UIMessage } from 'ai'
import {
  ContributionStore,
  useContributions,
} from '@/lib/extensions/contributions'
import { manifest } from '@/lib/extensions/__tests__/fixtures'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({}),
}))

describe('what a turn shows besides its messages', () => {
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

  /// Every kind of progress now reports itself where it happens: a tool call on
  /// its own card, a subagent on the chip beside the composer. What is left
  /// here is the model-load and prompt-reading progress, which has nowhere
  /// else to go.
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

  it('renders a system note on its own, with no message chrome', () => {
    render(
      <MessageItem
        message={
          {
            id: 'sys-1',
            role: 'system',
            parts: [
              {
                type: 'text',
                text: "Subagent 'researcher' (c1) finished. Its full answer is in /tmp/subagents/r.md",
              },
            ],
          } as UIMessage
        }
        isFirstMessage={false}
        isLastMessage={true}
        status="ready"
      />
    )
    expect(screen.getByText(/finished/)).toBeInTheDocument()
    // No copy/remember/regenerate: nobody said it, so there is nothing to act on.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('extension message actions', () => {
  const reply = {
    id: 'm2',
    role: 'assistant',
    parts: [{ type: 'text', text: 'hi' }],
  } as UIMessage

  it('offers contributed actions only when the thread is known', () => {
    const registration = new ContributionStore(
      useContributions
    ).registerExtension(
      manifest('acme.msg', {
        contributes: {
          commands: [{ id: 'explain', title: 'Explain' }],
          menus: { 'message/actions': [{ command: 'explain' }] },
        },
      })
    )
    try {
      const { rerender } = render(
        <MessageItem
          message={reply}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
        />
      )
      expect(screen.queryByLabelText('extensions:moreActions')).toBeNull()
      rerender(
        <MessageItem
          message={reply}
          isFirstMessage={false}
          isLastMessage={false}
          status="ready"
          threadId="t1"
        />
      )
      expect(screen.getByLabelText('extensions:moreActions')).toBeInTheDocument()
    } finally {
      registration.dispose()
    }
  })
})
