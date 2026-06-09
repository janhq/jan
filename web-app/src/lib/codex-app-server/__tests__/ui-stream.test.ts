import { describe, expect, it, vi } from 'vitest'
import { codexEventsToUIMessageStream } from '../ui-stream'
import type { CodexAppServerEvent } from '../types'

async function collect(stream: ReadableStream) {
  const reader = stream.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

async function* events(values: CodexAppServerEvent[]) {
  for (const value of values) {
    yield value
  }
}

describe('codexEventsToUIMessageStream', () => {
  it('maps assistant deltas into AI SDK text chunks and finishes the message', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'turn_started',
            threadId: 'thread-1',
            turnId: 'turn-1',
            turn: {},
          },
          {
            type: 'assistant_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'assistant-1',
            delta: 'hello',
          },
          {
            type: 'assistant_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'assistant-1',
            delta: ' world',
          },
          {
            type: 'turn_completed',
            threadId: 'thread-1',
            turnId: 'turn-1',
            turn: { status: 'completed' },
          },
        ]),
        { messageId: 'message-1' }
      )
    )

    expect(chunks).toEqual([
      { type: 'start', messageId: 'message-1' },
      { type: 'data-codex-event', data: expect.objectContaining({ type: 'turn_started' }) },
      { type: 'text-start', id: 'assistant-1' },
      { type: 'text-delta', id: 'assistant-1', delta: 'hello' },
      { type: 'text-delta', id: 'assistant-1', delta: ' world' },
      { type: 'data-codex-event', data: expect.objectContaining({ type: 'turn_completed' }) },
      { type: 'text-end', id: 'assistant-1' },
      {
        type: 'finish',
        finishReason: 'stop',
        messageMetadata: expect.objectContaining({
          codex: expect.objectContaining({ threadId: 'thread-1', turnId: 'turn-1' }),
        }),
      },
    ])
  })

  it('emits non-text Codex events as data chunks', async () => {
    const approval = {
      type: 'approval_request',
      request: { id: 'approval-1', method: 'item/commandExecution/requestApproval' },
    } satisfies CodexAppServerEvent

    const chunks = await collect(codexEventsToUIMessageStream(events([approval])))

    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'data-codex-event', data: approval },
      { type: 'finish', finishReason: 'stop', messageMetadata: expect.any(Object) },
    ])
  })

  it('propagates Codex stream errors as UI error chunks', async () => {
    const error = new Error('provider misconfigured')
    const chunks = await collect(
      codexEventsToUIMessageStream(events([{ type: 'error', error }]))
    )

    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'error', errorText: 'provider misconfigured' },
      { type: 'finish', finishReason: 'error', messageMetadata: expect.any(Object) },
    ])
  })

  it('interrupts the Codex turn when the UI stream is cancelled', async () => {
    const interrupt = vi.fn()
    const stream = codexEventsToUIMessageStream(
      events([
        {
          type: 'assistant_delta',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'assistant-1',
          delta: 'hello',
        },
      ]),
      { interrupt }
    )

    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()

    expect(interrupt).toHaveBeenCalled()
  })
})
