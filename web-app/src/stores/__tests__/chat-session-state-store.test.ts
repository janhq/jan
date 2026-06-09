import { beforeEach, describe, expect, it } from 'vitest'

import { useChatSessionState } from '../chat-session-state-store'

beforeEach(() => {
  localStorage.clear()
  useChatSessionState.setState({ bySession: {} })
})

describe('chat-session-state-store', () => {
  it('keeps independent UI state per session', () => {
    const store = useChatSessionState.getState()
    store.patchSession('thread-a', { sidePanelActiveSection: 'terminal' })
    store.patchSession('thread-b', { sidePanelActiveSection: 'browser' })

    expect(store.getSession('thread-a').sidePanelActiveSection).toBe('terminal')
    expect(store.getSession('thread-b').sidePanelActiveSection).toBe('browser')
  })

  it('returns stable default references for unset sessions', () => {
    const store = useChatSessionState.getState()
    const first = store.getSession('unset-session')
    const second = store.getSession('unset-session')

    expect(first).toBe(second)
    expect(first.terminalLinkedSessionIds).toBe(second.terminalLinkedSessionIds)
    expect(first.sidePanelOpenTabs).toBe(second.sidePanelOpenTabs)
  })

  it('transfers session state when a compose chat becomes a thread', () => {
    const store = useChatSessionState.getState()
    store.patchSession('home', {
      browserActiveUrl: 'https://example.com',
      terminalLinkedSessionIds: ['term-1'],
    })

    store.transferSession('home', 'thread-1')

    expect(store.getSession('thread-1').browserActiveUrl).toBe(
      'https://example.com'
    )
    expect(store.bySession.home).toBeUndefined()
  })
})