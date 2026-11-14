import { beforeEach, describe, expect, it } from 'vitest'
import { Chat } from '@ai-sdk/react'
import type { UIMessageChunk } from 'ai'
import {
  trackChat,
  observeChatWork,
  quiesceChats,
  forgetChat,
  __resetChatCloseForTests,
  resumeChatsAfterPreventedClose,
  withChatCloseDeadline,
} from '../chatClose'

// The close barrier itself, against the installed AI SDK `Chat`. Durable
// message writes (the second half of the PR's barrier) are not part of this
// port, so "settled" here means the stream was stopped and every pending
// finalizer ran.

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => __resetChatCloseForTests())

function streamChat(finalize: () => Promise<void> = async () => {}) {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const started = deferred()
  const pending = new Set<Promise<unknown>>()
  const finished: string[] = []
  const chat = new Chat({
    transport: {
      async sendMessages({ abortSignal }) {
        const stream = new ReadableStream<UIMessageChunk>({
          start(c) {
            controller = c
          },
        })
        abortSignal?.addEventListener('abort', () => {
          controller.error(new DOMException('Stopped', 'AbortError'))
        })
        started.resolve()
        return stream
      },
      async reconnectToStream() {
        return null
      },
    },
    onFinish: (event) =>
      observeChatWork(pending, async () => {
        await finalize()
        finished.push(event.message.id)
      }),
  })
  trackChat(chat, pending)
  return {
    chat,
    started,
    finished,
    push: (chunk: UIMessageChunk) => controller.enqueue(chunk),
  }
}

async function partial(id: string, finalize?: () => Promise<void>) {
  const stream = streamChat(finalize)
  const sending = stream.chat.sendMessage({ text: 'Question' })
  await stream.started.promise
  stream.push({ type: 'start', messageId: `${id}-answer` })
  stream.push({ type: 'text-start', id: 'text' })
  stream.push({ type: 'text-delta', id: 'text', delta: 'Partial survived' })
  await new Promise((r) => setTimeout(r, 0))
  return { ...stream, sending }
}

describe('ordinary Chat close barrier using installed SDK', () => {
  it('a rejected public operation does not poison later closes', async () => {
    const stream = streamChat()
    await expect(stream.chat.regenerate({ messageId: 'missing' })).rejects.toThrow()
    await quiesceChats()
  })

  it('waits for an async onFinish finalizer before the close resolves', async () => {
    const finish = deferred()
    const stream = await partial('a', () => finish.promise)
    let closed = false
    const closing = quiesceChats().then(() => {
      closed = true
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(closed).toBe(false)
    finish.resolve()
    await stream.sending
    await closing
    expect(closed).toBe(true)
    expect(stream.finished).toEqual(['a-answer'])
  })

  it('stops all background chats, not only the active route', async () => {
    const a = await partial('a')
    const b = await partial('b')
    await quiesceChats()
    expect(a.finished).toEqual(['a-answer'])
    expect(b.finished).toEqual(['b-answer'])
  })

  it('refuses new operations while closing and accepts them again after a prevented close', async () => {
    const stream = streamChat()
    await quiesceChats()
    await stream.chat.sendMessage({ text: 'ignored' }) // guarded: no-op
    expect(stream.chat.messages).toHaveLength(0)
    resumeChatsAfterPreventedClose()
    void stream.chat.sendMessage({ text: 'accepted' })
    await stream.started.promise
    expect(stream.chat.messages).toHaveLength(1)
    stream.chat.stop()
  })

  it('a forgotten chat no longer participates', async () => {
    const stream = await partial('gone')
    forgetChat(stream.chat)
    await quiesceChats() // must not wait on, or stop, the forgotten chat
    expect(stream.finished).toEqual([])
    stream.chat.stop()
  })

  it('a whole-attempt deadline fails the close and a retry still awaits the finalizer', async () => {
    const tools = deferred()
    const stream = await partial('tools', () => tools.promise)
    await expect(withChatCloseDeadline(quiesceChats(), 10)).rejects.toThrow('timed out')
    resumeChatsAfterPreventedClose()
    tools.resolve()
    await quiesceChats()
    expect(stream.finished).toEqual(['tools-answer'])
  })
})
