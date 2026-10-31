import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Chat } from '@ai-sdk/react'
import type { UIMessageChunk } from 'ai'
import { trackChat, observeChatWork, quiesceChats, __resetChatCloseForTests, resumeChatsAfterPreventedClose, withChatCloseDeadline } from '../chatClose'
import { useMessages, flushMessageWrites, __resetMessageWritesForTests } from '@/hooks/useMessages'
const disk = vi.hoisted(() => ({ messages: new Map<string, any>(), create: vi.fn(), modify: vi.fn(), remove: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ messages: () => ({ createMessage: disk.create, modifyMessage: disk.modify, deleteMessage: disk.remove }) }) }))
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  __resetChatCloseForTests(); __resetMessageWritesForTests(); useMessages.setState({ messages: {} }); disk.messages.clear()
  disk.create.mockReset().mockImplementation(async (m) => { disk.messages.set(m.id, structuredClone(m)); return m })
  disk.modify.mockReset().mockImplementation(async (m) => { disk.messages.set(m.id, structuredClone(m)); return m })
  disk.remove.mockReset().mockImplementation(async (_, id) => { disk.messages.delete(id) })
})
function streamChat(threadId: string, finalize = async () => {}) {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const started = deferred()
  const pending = new Set<Promise<unknown>>()
  const chat = new Chat({
    transport: {
      async sendMessages({ abortSignal }) {
        const stream = new ReadableStream<UIMessageChunk>({ start(c) { controller = c } })
        abortSignal?.addEventListener('abort', () => { controller.error(new DOMException('Stopped', 'AbortError')) })
        started.resolve(); return stream
      },
      async reconnectToStream() { return null },
    },
    onFinish: (event) => observeChatWork(pending, async () => {
      await finalize()
      useMessages.getState().addMessage({ id: event.message.id, thread_id: threadId, role: 'assistant', content: event.message.parts, metadata: { stopped: event.isAbort } } as any)
    }),
  })
  trackChat(chat, pending)
  return { chat, started, push: (chunk: UIMessageChunk) => controller.enqueue(chunk) }
}
async function partial(threadId: string, finalize?: () => Promise<void>) {
  const stream = streamChat(threadId, finalize)
  const sending = stream.chat.sendMessage({ text: 'Question' })
  await stream.started.promise
  stream.push({ type: 'start', messageId: `${threadId}-answer` })
  stream.push({ type: 'text-start', id: 'text' })
  stream.push({ type: 'text-delta', id: 'text', delta: 'Twelve chunks survived' })
  await vi.waitFor(() => expect(stream.chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ text: 'Twelve chunks survived' })))
  return { ...stream, sending }
}
describe('ordinary Chat close barrier using installed SDK', () => {
  it('a rejected public operation does not poison later closes', async () => {
    const stream = streamChat('invalid')
    await expect(stream.chat.regenerate({ messageId: 'missing' })).rejects.toThrow()
    await quiesceChats()
    await flushMessageWrites()
  })
  it('waits for async onFinish and durable writes; assistant partial survives reload', async () => {
    const finish = deferred(); const write = deferred()
    disk.create.mockImplementation(async (m) => { await write.promise; disk.messages.set(m.id, structuredClone(m)); return m })
    const stream = await partial('a', () => finish.promise)
    let closed = false
    const closing = (async () => { await quiesceChats(); await flushMessageWrites(); closed = true })()
    await Promise.resolve(); expect(closed).toBe(false)
    finish.resolve(); await stream.sending
    await Promise.resolve(); expect(closed).toBe(false)
    write.resolve(); await closing
    useMessages.setState({ messages: {} })
    expect(disk.messages.get('a-answer')).toMatchObject({ metadata: { stopped: true }, content: [expect.objectContaining({ text: 'Twelve chunks survived' })] })
    expect(disk.create).toHaveBeenCalledTimes(1)
  })
  it('stops all background threads, not only the active route', async () => {
    await partial('a'); await partial('b'); await quiesceChats(); await flushMessageWrites()
    expect([...disk.messages.keys()].sort()).toEqual(['a-answer', 'b-answer'])
  })
  it('failed write prevents close, preserves later modify/delete order and retries', async () => {
    disk.create.mockRejectedValueOnce(new Error('disk full'))
    await partial('a'); await quiesceChats()
    useMessages.getState().updateMessage({ ...useMessages.getState().getMessages('a')[0], metadata: { latest: true } })
    await expect(flushMessageWrites()).rejects.toThrow('disk full')
    expect(disk.modify).not.toHaveBeenCalled()
    resumeChatsAfterPreventedClose(); await quiesceChats(); await flushMessageWrites()
    expect(disk.messages.get('a-answer').metadata).toEqual({ latest: true })
    useMessages.getState().deleteMessage('a', 'a-answer'); await flushMessageWrites()
    expect(disk.messages.size).toBe(0)
  })
  it('whole-attempt deadline prevents closing and retry retains finalization', async () => {
    const tools = deferred(); await partial('tools', () => tools.promise)
    await expect(withChatCloseDeadline(quiesceChats(), 10)).rejects.toThrow('timed out')
    resumeChatsAfterPreventedClose(); tools.resolve(); await quiesceChats(); await flushMessageWrites()
    expect(disk.messages.has('tools-answer')).toBe(true)
  })
})
