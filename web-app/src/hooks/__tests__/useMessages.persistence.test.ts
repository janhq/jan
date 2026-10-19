import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentType, MessageStatus, type ThreadMessage } from '@janhq/core'
import { useMessages } from '../useMessages'

const service = vi.hoisted(() => ({
  createMessage: vi.fn(),
  modifyMessage: vi.fn(),
  deleteMessage: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ messages: () => service }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const message = (id = 'root', threadId = 'thread'): ThreadMessage => ({
  id, thread_id: threadId, object: 'thread.message',
  role: 'user' as ThreadMessage['role'], status: MessageStatus.Ready,
  created_at: 1, completed_at: 1,
  content: [{ type: ContentType.Text, text: { value: id, annotations: [] } }],
})

describe('message persistence ordering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    service.createMessage.mockImplementation(async (value) => value)
    service.modifyMessage.mockImplementation(async (value) => value)
    service.deleteMessage.mockResolvedValue(undefined)
    useMessages.setState({ messages: {} })
  })

  it('does not overwrite branch metadata with a late create acknowledgement', async () => {
    const created = deferred<ThreadMessage>()
    service.createMessage.mockReturnValueOnce(created.promise)
    const original = message()
    useMessages.getState().addMessage(original)
    const branched = { ...original, metadata: { parentId: null, activeChildId: 'reply' } }
    useMessages.getState().updateMessage(branched)
    created.resolve(original)
    await vi.waitFor(() => expect(service.modifyMessage).toHaveBeenCalled())
    expect(useMessages.getState().getMessages('thread')[0]).toEqual(branched)
  })

  it('persists create, branch updates and delete in order before reloading', async () => {
    const created = deferred<ThreadMessage>()
    const disk = new Map<string, ThreadMessage>()
    const calls: string[] = []
    service.createMessage.mockImplementation(async (value: ThreadMessage) => {
      calls.push('create')
      await created.promise
      disk.set(value.id, value)
      return value
    })
    service.modifyMessage.mockImplementation(async (value: ThreadMessage) => {
      calls.push(`modify:${value.metadata?.activeChildId}`)
      disk.set(value.id, value)
      return value
    })
    service.deleteMessage.mockImplementation(async (_thread: string, id: string) => {
      calls.push('delete')
      disk.delete(id)
    })
    const original = message()
    useMessages.getState().addMessage(original)
    useMessages.getState().updateMessage({ ...original, metadata: { activeChildId: 'first' } })
    useMessages.getState().updateMessage({ ...original, metadata: { activeChildId: 'second' } })
    useMessages.getState().deleteMessage('thread', original.id)
    const callsWhileCreating = [...calls]
    created.resolve(original)
    await vi.waitFor(() => expect(calls).toContain('delete'))
    await Promise.resolve()
    expect(callsWhileCreating).toEqual(['create'])
    expect(calls).toEqual(['create', 'modify:first', 'modify:second', 'delete'])
    useMessages.getState().clearAllMessages()
    useMessages.getState().setMessages('thread', [...disk.values()])
    expect(useMessages.getState().getMessages('thread')).toEqual([])
  })

  it('does not repopulate a cleared store when a create finishes', async () => {
    const created = deferred<ThreadMessage>()
    service.createMessage.mockReturnValueOnce(created.promise)
    const original = message()
    useMessages.getState().addMessage(original)
    useMessages.getState().clearAllMessages()
    created.resolve(original)
    await created.promise
    await Promise.resolve()
    expect(useMessages.getState().messages).toEqual({})
  })

  it('allows another thread to persist while one thread is blocked', async () => {
    const created = deferred<ThreadMessage>()
    service.createMessage.mockReturnValueOnce(created.promise)
    const first = message('first', 'one')
    const second = message('second', 'two')
    useMessages.getState().addMessage(first)
    useMessages.getState().updateMessage({ ...first, metadata: { parentId: null } })
    useMessages.getState().addMessage(second)
    useMessages.getState().updateMessage({ ...second, metadata: { parentId: null } })
    await vi.waitFor(() => expect(service.modifyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_id: 'two' })
    ))
    const threadsWhileBlocked = service.modifyMessage.mock.calls.map(([value]) => value.thread_id)
    created.resolve(first)
    await vi.waitFor(() => expect(service.modifyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_id: 'one' })
    ))
    expect(threadsWhileBlocked).toEqual(['two'])
  })

  it('continues with the queued deletion after a write fails', async () => {
    const updated = deferred<ThreadMessage>()
    service.modifyMessage.mockReturnValueOnce(updated.promise)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const original = message()
      useMessages.getState().setMessages('thread', [original])
      useMessages.getState().updateMessage({ ...original, metadata: { parentId: null } })
      useMessages.getState().deleteMessage('thread', original.id)
      const deletedWhileUpdating = service.deleteMessage.mock.calls.length
      updated.reject(new Error('storage unavailable'))
      await vi.waitFor(() => expect(error).toHaveBeenCalled())
      await vi.waitFor(() => expect(service.deleteMessage).toHaveBeenCalledWith('thread', original.id))
      expect(deletedWhileUpdating).toBe(0)
      expect(useMessages.getState().getMessages('thread')).toEqual([])
    } finally {
      error.mockRestore()
    }
  })
})
