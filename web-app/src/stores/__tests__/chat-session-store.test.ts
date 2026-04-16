import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useChatSessions,
  isSessionBusy,
  type ChatSession,
} from '../chat-session-store'
import { useMessageQueue } from '../message-queue-store'

type FakeChat = {
  status: string
  messages: any[]
  stop: ReturnType<typeof vi.fn>
  '~registerStatusCallback': ReturnType<typeof vi.fn>
}

const makeChat = (status = 'ready'): FakeChat => {
  const callbacks: Array<() => void> = []
  return {
    status,
    messages: [],
    stop: vi.fn(),
    '~registerStatusCallback': vi.fn((cb: () => void) => {
      callbacks.push(cb)
      return () => {
        const i = callbacks.indexOf(cb)
        if (i >= 0) callbacks.splice(i, 1)
      }
    }),
  }
}

beforeEach(() => {
  useChatSessions.getState().clearSessions()
})

describe('isSessionBusy', () => {
  it('returns false for undefined session', () => {
    expect(isSessionBusy(undefined)).toBe(false)
  })

  it('returns true when session is streaming', () => {
    expect(
      isSessionBusy({
        isStreaming: true,
        data: { tools: [], messages: [], idMap: new Map() },
      } as unknown as ChatSession)
    ).toBe(true)
  })

  it('returns true when pending tools exist', () => {
    expect(
      isSessionBusy({
        isStreaming: false,
        data: { tools: [{}], messages: [], idMap: new Map() },
      } as unknown as ChatSession)
    ).toBe(true)
  })

  it('returns false when idle with no tools', () => {
    expect(
      isSessionBusy({
        isStreaming: false,
        data: { tools: [], messages: [], idMap: new Map() },
      } as unknown as ChatSession)
    ).toBe(false)
  })
})

describe('setActiveConversationId', () => {
  it('updates the active conversation id', () => {
    useChatSessions.getState().setActiveConversationId('abc')
    expect(useChatSessions.getState().activeConversationId).toBe('abc')
    useChatSessions.getState().setActiveConversationId(undefined)
    expect(useChatSessions.getState().activeConversationId).toBeUndefined()
  })
})

describe('getSessionData', () => {
  it('creates standalone data when session does not exist', () => {
    const data = useChatSessions.getState().getSessionData('orphan')
    expect(data).toEqual({ tools: [], messages: [], idMap: expect.any(Map) })
  })

  it('returns the same standalone data on subsequent calls', () => {
    const a = useChatSessions.getState().getSessionData('x')
    const b = useChatSessions.getState().getSessionData('x')
    expect(a).toBe(b)
  })
})

describe('ensureSession', () => {
  it('creates a new session and sets it active', () => {
    const chat = makeChat('ready')
    const transport = { dummy: true } as any
    const created = useChatSessions
      .getState()
      .ensureSession('s1', transport, () => chat as any, 'My Title')

    expect(created).toBe(chat)
    const state = useChatSessions.getState()
    expect(state.activeConversationId).toBe('s1')
    expect(state.sessions.s1.title).toBe('My Title')
    expect(state.sessions.s1.isStreaming).toBe(false)
    expect(chat['~registerStatusCallback']).toHaveBeenCalled()
  })

  it('marks streaming when initial status is "streaming"', () => {
    const chat = makeChat('streaming')
    useChatSessions
      .getState()
      .ensureSession('s1', {} as any, () => chat as any)
    expect(useChatSessions.getState().sessions.s1.isStreaming).toBe(true)
  })

  it('reuses existing session and syncs transport/title when changed', () => {
    const chat = makeChat('ready')
    const t1 = { v: 1 } as any
    const t2 = { v: 2 } as any
    useChatSessions
      .getState()
      .ensureSession('s1', t1, () => chat as any, 'first')

    // Second call reuses same chat; only updates metadata
    const chat2 = makeChat('ready')
    const returned = useChatSessions
      .getState()
      .ensureSession('s1', t2, () => chat2 as any, 'second')
    expect(returned).toBe(chat)
    expect(useChatSessions.getState().sessions.s1.transport).toBe(t2)
    expect(useChatSessions.getState().sessions.s1.title).toBe('second')
  })

  it('adopts standalone data if it existed before the session', () => {
    const pre = useChatSessions.getState().getSessionData('pending-id')
    pre.tools.push({ id: 'tool-a' })

    const chat = makeChat('ready')
    useChatSessions
      .getState()
      .ensureSession('pending-id', {} as any, () => chat as any)

    const data = useChatSessions.getState().sessions['pending-id'].data
    expect(data.tools).toEqual([{ id: 'tool-a' }])
  })
})

describe('updateStatus', () => {
  it('no-ops for unknown session', () => {
    useChatSessions.getState().updateStatus('nope', 'streaming' as any)
    expect(useChatSessions.getState().sessions.nope).toBeUndefined()
  })

  it('transitions isStreaming flag on status change', () => {
    const chat = makeChat('ready')
    useChatSessions.getState().ensureSession('s1', {} as any, () => chat as any)
    useChatSessions.getState().updateStatus('s1', 'streaming' as any)
    expect(useChatSessions.getState().sessions.s1.isStreaming).toBe(true)
    useChatSessions.getState().updateStatus('s1', 'ready' as any)
    expect(useChatSessions.getState().sessions.s1.isStreaming).toBe(false)
  })

  it('short-circuits when status is unchanged', () => {
    const chat = makeChat('ready')
    useChatSessions.getState().ensureSession('s1', {} as any, () => chat as any)
    const before = useChatSessions.getState().sessions.s1
    useChatSessions.getState().updateStatus('s1', 'ready' as any)
    expect(useChatSessions.getState().sessions.s1).toBe(before)
  })
})

describe('setSessionTitle', () => {
  it('ignores empty title', () => {
    const chat = makeChat('ready')
    useChatSessions
      .getState()
      .ensureSession('s1', {} as any, () => chat as any, 'original')
    useChatSessions.getState().setSessionTitle('s1', undefined)
    expect(useChatSessions.getState().sessions.s1.title).toBe('original')
  })

  it('updates title when different', () => {
    const chat = makeChat('ready')
    useChatSessions
      .getState()
      .ensureSession('s1', {} as any, () => chat as any, 'a')
    useChatSessions.getState().setSessionTitle('s1', 'b')
    expect(useChatSessions.getState().sessions.s1.title).toBe('b')
  })

  it('no-ops for unknown session', () => {
    useChatSessions.getState().setSessionTitle('nope', 'title')
    expect(useChatSessions.getState().sessions.nope).toBeUndefined()
  })
})

describe('removeSession', () => {
  it('removes session, stops chat, unsubscribes, and clears queue', () => {
    const chat = makeChat('ready')
    useChatSessions.getState().ensureSession('s1', {} as any, () => chat as any)

    const clearQueueSpy = vi.spyOn(useMessageQueue.getState(), 'clearQueue')
    useChatSessions.getState().removeSession('s1')

    expect(useChatSessions.getState().sessions.s1).toBeUndefined()
    expect(chat.stop).toHaveBeenCalled()
    expect(clearQueueSpy).toHaveBeenCalledWith('s1')
    clearQueueSpy.mockRestore()
  })

  it('clears standalone data when no session exists for the id', () => {
    useChatSessions.getState().getSessionData('orphan').tools.push({})
    useChatSessions.getState().removeSession('orphan')
    // Recreating yields fresh empty data
    expect(useChatSessions.getState().getSessionData('orphan').tools).toEqual([])
  })

  it('survives unsubscribe errors', () => {
    const chat = makeChat('ready')
    chat['~registerStatusCallback'] = vi.fn(() => () => {
      throw new Error('boom')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useChatSessions.getState().ensureSession('s1', {} as any, () => chat as any)
    expect(() => useChatSessions.getState().removeSession('s1')).not.toThrow()
    spy.mockRestore()
  })
})

describe('clearSessions', () => {
  it('removes all sessions and resets active id', () => {
    const c1 = makeChat('ready')
    const c2 = makeChat('ready')
    useChatSessions.getState().ensureSession('a', {} as any, () => c1 as any)
    useChatSessions.getState().ensureSession('b', {} as any, () => c2 as any)

    useChatSessions.getState().clearSessions()

    expect(useChatSessions.getState().sessions).toEqual({})
    expect(useChatSessions.getState().activeConversationId).toBeUndefined()
    expect(c1.stop).toHaveBeenCalled()
    expect(c2.stop).toHaveBeenCalled()
  })

  it('swallows stop() errors', () => {
    const chat = makeChat('ready')
    chat.stop.mockImplementation(() => {
      throw new Error('bad')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useChatSessions.getState().ensureSession('s1', {} as any, () => chat as any)
    expect(() => useChatSessions.getState().clearSessions()).not.toThrow()
    spy.mockRestore()
  })
})
