import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// The thread route is reused across thread switches, so useChat outlives a
// session. A turn left running in the background (#9311) keeps using its
// session's transport, which must therefore never be handed to, or rewritten
// by, the thread opened next.

vi.mock('@/lib/custom-chat-transport', () => ({
  CustomChatTransport: class {
    systemMessage?: string
    threadId?: string
    constructor(systemMessage?: string, threadId?: string) {
      this.systemMessage = systemMessage
      this.threadId = threadId
    }
    updateSystemMessage(systemMessage?: string) {
      this.systemMessage = systemMessage
    }
    setOnTokenUsage() {}
    refreshTools() {}
  },
}))
vi.mock('@ai-sdk/react', () => ({
  Chat: class {
    status = 'ready'
    transport: unknown
    constructor(init: { transport: unknown }) {
      this.transport = init.transport
    }
    stop() {}
  },
  useChat: () => ({ status: 'ready', messages: [] }),
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: (s: unknown) => unknown) =>
    selector({ mcpToolNames: new Set(), ragToolNames: new Set() }),
}))

import { useChat } from '../use-chat'
import { useChatSessions } from '@/stores/chat-session-store'

type FakeTransport = { systemMessage?: string; threadId?: string }

const transportOf = (sessionId: string) =>
  useChatSessions.getState().sessions[sessionId]?.transport as unknown as
    | FakeTransport
    | undefined

describe('useChat transport per session', () => {
  beforeEach(() => {
    useChatSessions.getState().clearSessions()
  })

  it('gives a newly opened thread its own transport', () => {
    const { rerender } = renderHook(
      (props: { sessionId: string; systemMessage: string }) => useChat(props),
      { initialProps: { sessionId: 'a', systemMessage: 'A rules' } }
    )
    rerender({ sessionId: 'b', systemMessage: 'B rules' })

    expect(transportOf('b')).not.toBe(transportOf('a'))
    expect(transportOf('b')).toMatchObject({
      threadId: 'b',
      systemMessage: 'B rules',
    })
    // A's turn may still be running: its instructions must be A's.
    expect(transportOf('a')).toMatchObject({
      threadId: 'a',
      systemMessage: 'A rules',
    })
  })

  it('goes back to the session transport a thread already has', () => {
    const { rerender } = renderHook(
      (props: { sessionId: string; systemMessage: string }) => useChat(props),
      { initialProps: { sessionId: 'a', systemMessage: 'A rules' } }
    )
    const a = transportOf('a')
    rerender({ sessionId: 'b', systemMessage: 'B rules' })
    rerender({ sessionId: 'a', systemMessage: 'A rules' })

    expect(transportOf('a')).toBe(a)
    expect(transportOf('b')?.systemMessage).toBe('B rules')
  })
})
