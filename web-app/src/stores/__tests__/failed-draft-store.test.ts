import { describe, it, expect, beforeEach } from 'vitest'
import {
  useFailedDrafts,
  mergeRestoredAttachments,
} from '../failed-draft-store'
import { useMessageQueue } from '../message-queue-store'
import { useChatSessions } from '../chat-session-store'
import { dropConversationClientThread } from '@/lib/conversationClientTools'

const file = (name: string, extra: object = {}) =>
  ({ name, type: 'document', path: `/${name}`, ...extra }) as never

describe('useFailedDrafts', () => {
  beforeEach(() => {
    useFailedDrafts.setState({ drafts: {} })
    useMessageQueue.setState({ queues: {} })
  })

  it('stores text and an attachment snapshot as one entry per thread', () => {
    const attachments = [file('a.pdf')]
    const entry = useFailedDrafts
      .getState()
      .add('t1', { text: 'hello', attachments })
    attachments.push(file('later.pdf'))
    expect(entry?.attachments).toEqual([file('a.pdf')])
    expect(useFailedDrafts.getState().getDrafts('t1')).toHaveLength(1)
    expect(useFailedDrafts.getState().getDrafts('t2')).toEqual([])
  })

  it('ignores a draft with neither text nor files', () => {
    expect(
      useFailedDrafts.getState().add('t1', { text: '  ', attachments: [] })
    ).toBeUndefined()
    expect(useFailedDrafts.getState().drafts).toEqual({})
  })

  it('keeps files-only and text-only drafts', () => {
    useFailedDrafts.getState().add('t1', { text: '', attachments: [file('a')] })
    useFailedDrafts.getState().add('t1', { text: 'x', attachments: [] })
    expect(useFailedDrafts.getState().getDrafts('t1')).toHaveLength(2)
  })

  it('removes one entry and drops the empty thread key', () => {
    const a = useFailedDrafts.getState().add('t1', { text: 'a', attachments: [] })!
    const b = useFailedDrafts.getState().add('t1', { text: 'b', attachments: [] })!
    useFailedDrafts.getState().remove('t1', a.id)
    expect(useFailedDrafts.getState().getDrafts('t1')).toEqual([b])
    useFailedDrafts.getState().remove('t1', b.id)
    expect(useFailedDrafts.getState().drafts).toEqual({})
  })

  it('never touches the auto-send queue', () => {
    useFailedDrafts.getState().add('t1', { text: 'a', attachments: [file('f')] })
    expect(useMessageQueue.getState().getQueue('t1')).toEqual([])
  })

  it('merges restored attachments ahead, without duplicating newer ones', () => {
    const old = file('a')
    const newer = file('b')
    expect(mergeRestoredAttachments([old, old], [newer])).toEqual([old, newer])
    const newerCopy = file('a', { processed: true })
    expect(mergeRestoredAttachments([old], [newerCopy, newer])).toEqual([
      newerCopy,
      newer,
    ])
  })
})

describe('useFailedDrafts lifetime', () => {
  beforeEach(() => {
    useFailedDrafts.setState({ drafts: {} })
    useChatSessions.setState({ sessions: {} })
  })

  it('clearThread drops the entries and refuses a stale add for that thread only', () => {
    const { add, getToken, clearThread, getDrafts } = useFailedDrafts.getState()
    add('t1', { text: 'old', attachments: [file('a.png')] })
    const stale = getToken('t1')
    const other = getToken('t2')
    clearThread('t1')
    expect(getDrafts('t1')).toEqual([])
    expect(add('t1', { text: 'late', attachments: [file('b.png')] }, stale)).toBeUndefined()
    expect(getDrafts('t1')).toEqual([])
    expect(add('t2', { text: 'fine', attachments: [] }, other)).toBeDefined()
    expect(add('t1', { text: 'fresh', attachments: [] }, getToken('t1'))).toBeDefined()
  })

  it('clearAll drops every thread and refuses every stale add', () => {
    const { add, getToken, clearAll, getDrafts } = useFailedDrafts.getState()
    add('t1', { text: 'one', attachments: [] })
    add('t2', { text: 'two', attachments: [file('x.png')] })
    const t1 = getToken('t1')
    const t2 = getToken('t2')
    clearAll()
    expect(getDrafts('t1')).toEqual([])
    expect(getDrafts('t2')).toEqual([])
    expect(add('t1', { text: 'late', attachments: [] }, t1)).toBeUndefined()
    expect(add('t2', { text: 'late', attachments: [file('y.png')] }, t2)).toBeUndefined()
    expect(useFailedDrafts.getState().drafts).toEqual({})
  })

  it('thread deletion through the drop hook clears the draft and invalidates the token', () => {
    const { add, getToken } = useFailedDrafts.getState()
    add('t1', { text: 'x', attachments: [file('a.png')] })
    const token = getToken('t1')
    dropConversationClientThread('t1')
    expect(useFailedDrafts.getState().getDrafts('t1')).toEqual([])
    expect(add('t1', { text: 'late', attachments: [] }, token)).toBeUndefined()
  })

  it('removeSession clears a failed-only thread and refuses the in-flight failure', () => {
    const { add, getToken } = useFailedDrafts.getState()
    add('t1', { text: 'x', attachments: [file('a.png')] })
    const token = getToken('t1')
    useChatSessions.getState().removeSession('t1')
    expect(useFailedDrafts.getState().getDrafts('t1')).toEqual([])
    expect(add('t1', { text: 'late', attachments: [file('b.png')] }, token)).toBeUndefined()
  })

  it('a session reset (clearSessions) leaves no old failed media, including failed-only threads', () => {
    const { add, getToken } = useFailedDrafts.getState()
    add('failed-only', { text: 'x', attachments: [file('a.png')] })
    const token = getToken('other')
    useChatSessions.getState().clearSessions()
    expect(useFailedDrafts.getState().drafts).toEqual({})
    expect(add('other', { text: 'late', attachments: [file('b.png')] }, token)).toBeUndefined()
  })
})
