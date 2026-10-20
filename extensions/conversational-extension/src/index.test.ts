import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JanConversationalExtension from './index'

type ApiMock = Record<string, ReturnType<typeof vi.fn>>

function makeApi(): ApiMock {
  return {
    listThreads: vi.fn(),
    createThread: vi.fn(),
    modifyThread: vi.fn(),
    deleteThread: vi.fn(),
    createMessage: vi.fn(),
    modifyMessage: vi.fn(),
    deleteMessage: vi.fn(),
    listMessages: vi.fn(),
    getThreadAssistant: vi.fn(),
    createThreadAssistant: vi.fn(),
    modifyThreadAssistant: vi.fn(),
  }
}

let api: ApiMock
let ext: JanConversationalExtension

beforeEach(() => {
  api = makeApi()
  ;(globalThis as any).window = { core: { api } }
  ext = new JanConversationalExtension()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('lifecycle', () => {
  it('onLoad resolves without error', async () => {
    await expect(ext.onLoad()).resolves.toBeUndefined()
  })

  it('onUnload returns undefined', () => {
    expect(ext.onUnload()).toBeUndefined()
  })
})

describe('threads', () => {
  it('listThreads returns the api result', async () => {
    const threads = [{ id: 't1' }, { id: 't2' }]
    api.listThreads.mockResolvedValue(threads)

    await expect(ext.listThreads()).resolves.toEqual(threads)
    expect(api.listThreads).toHaveBeenCalledWith()
  })

  it('createThread wraps the thread in an object and returns the result', async () => {
    const thread = { id: 't1', title: 'hi' } as any
    api.createThread.mockResolvedValue(thread)

    await expect(ext.createThread(thread)).resolves.toBe(thread)
    expect(api.createThread).toHaveBeenCalledWith({ thread })
  })

  it('modifyThread forwards the thread object', async () => {
    const thread = { id: 't1' } as any
    api.modifyThread.mockResolvedValue(undefined)

    await expect(ext.modifyThread(thread)).resolves.toBeUndefined()
    expect(api.modifyThread).toHaveBeenCalledWith({ thread })
  })

  it('deleteThread forwards the threadId in an object', async () => {
    api.deleteThread.mockResolvedValue(undefined)

    await ext.deleteThread('t1')
    expect(api.deleteThread).toHaveBeenCalledWith({ threadId: 't1' })
  })

  it('propagates a rejection from listThreads', async () => {
    api.listThreads.mockRejectedValue(new Error('disk gone'))
    await expect(ext.listThreads()).rejects.toThrow('disk gone')
  })
})

describe('messages', () => {
  it('createMessage wraps the message and returns the result', async () => {
    const message = { id: 'm1', thread_id: 't1' } as any
    api.createMessage.mockResolvedValue(message)

    await expect(ext.createMessage(message)).resolves.toBe(message)
    expect(api.createMessage).toHaveBeenCalledWith({ message })
  })

  it('modifyMessage wraps the message and returns the result', async () => {
    const message = { id: 'm1' } as any
    api.modifyMessage.mockResolvedValue(message)

    await expect(ext.modifyMessage(message)).resolves.toBe(message)
    expect(api.modifyMessage).toHaveBeenCalledWith({ message })
  })

  it('deleteMessage forwards both ids in an object', async () => {
    api.deleteMessage.mockResolvedValue(undefined)

    await ext.deleteMessage('t1', 'm1')
    expect(api.deleteMessage).toHaveBeenCalledWith({
      threadId: 't1',
      messageId: 'm1',
    })
  })

  it('listMessages returns messages in the order provided by the api', async () => {
    const messages = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
    api.listMessages.mockResolvedValue(messages)

    const result = await ext.listMessages('t1')
    expect(result).toEqual(messages)
    expect(result.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(api.listMessages).toHaveBeenCalledWith({ threadId: 't1' })
  })

  it('listMessages returns an empty array when the thread has no messages', async () => {
    api.listMessages.mockResolvedValue([])
    await expect(ext.listMessages('empty')).resolves.toEqual([])
  })
})

describe('assistants', () => {
  it('getThreadAssistant forwards the threadId in an object', async () => {
    const assistant = { id: 'a1' }
    api.getThreadAssistant.mockResolvedValue(assistant)

    await expect(ext.getThreadAssistant('t1')).resolves.toBe(assistant)
    expect(api.getThreadAssistant).toHaveBeenCalledWith({ threadId: 't1' })
  })

  it('createThreadAssistant wraps args in a single object matching the api contract', async () => {
    const assistant = { id: 'a1' } as any
    api.createThreadAssistant.mockResolvedValue(assistant)

    await expect(ext.createThreadAssistant('t1', assistant)).resolves.toBe(
      assistant
    )
    expect(api.createThreadAssistant).toHaveBeenCalledWith({
      threadId: 't1',
      assistant,
    })
  })

  it('modifyThreadAssistant wraps both arguments in a single object', async () => {
    const assistant = { id: 'a1' } as any
    api.modifyThreadAssistant.mockResolvedValue(assistant)

    await expect(ext.modifyThreadAssistant('t1', assistant)).resolves.toBe(
      assistant
    )
    expect(api.modifyThreadAssistant).toHaveBeenCalledWith({
      threadId: 't1',
      assistant,
    })
  })
})
