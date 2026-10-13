import { describe, expect, it } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import {
  STOPPED_TOOL_ERROR,
  settleStoppedToolCalls,
  untilAborted,
} from '../stopped-tool-calls'
import {
  convertThreadMessageToUIMessage,
  extractContentPartsFromUIMessage,
} from '../messages'

const assistant = (parts: unknown[], metadata?: object): UIMessage =>
  ({ id: 'a1', role: 'assistant', parts, metadata }) as UIMessage

const tool = (state: string, extra: object = {}) => ({
  type: 'tool-slow_wait',
  toolCallId: 'c1',
  input: { seconds: 20 },
  state,
  ...extra,
})

describe('settleStoppedToolCalls', () => {
  it.each(['input-streaming', 'input-available'])(
    'settles a call left in %s as a stopped error',
    (state) => {
      const [message] = settleStoppedToolCalls([assistant([tool(state)])])
      expect(message.parts[0]).toMatchObject({
        state: 'output-error',
        errorText: STOPPED_TOOL_ERROR,
        input: { seconds: 20 },
      })
      expect(message.metadata).toMatchObject({ stopped: true })
    }
  )

  it('leaves finished calls and their message alone', () => {
    const done = assistant([
      tool('output-available', { output: 'ok' }),
      { type: 'text', text: 'hi' },
    ])
    const messages = [done]
    expect(settleStoppedToolCalls(messages)).toBe(messages)
  })

  it('settles only the unfinished call of a turn with several', () => {
    const [message] = settleStoppedToolCalls([
      assistant([
        tool('output-available', { toolCallId: 'c0', output: 'ok' }),
        tool('input-available'),
      ]),
    ])
    expect(message.parts[0]).toMatchObject({ state: 'output-available' })
    expect(message.parts[1]).toMatchObject({ state: 'output-error' })
  })

  it('keeps the reason through persistence and a reload', () => {
    const [stopped] = settleStoppedToolCalls([
      assistant([tool('input-streaming')]),
    ])
    const content = extractContentPartsFromUIMessage(stopped)
    expect(content[0]).toMatchObject({
      type: 'tool_call',
      output: STOPPED_TOOL_ERROR,
    })

    const reloaded = convertThreadMessageToUIMessage({
      id: 'a1',
      role: 'assistant',
      content,
    } as Parameters<typeof convertThreadMessageToUIMessage>[0])
    // Not `input-available`: that is what renders "Running".
    expect(reloaded?.parts[0]).toMatchObject({
      state: 'output-available',
      output: STOPPED_TOOL_ERROR,
    })
  })
})

describe('untilAborted', () => {
  it('passes the result through while not aborted', async () => {
    const controller = new AbortController()
    await expect(
      untilAborted(Promise.resolve(7), controller.signal)
    ).resolves.toBe(7)
  })

  it('rejects as soon as the signal aborts, though the call never returns', async () => {
    const controller = new AbortController()
    const never = new Promise<string>(() => {})
    const raced = untilAborted(never, controller.signal)
    controller.abort()
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects at once when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      untilAborted(Promise.resolve(1), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it("forwards the call's own failure", async () => {
    const controller = new AbortController()
    await expect(
      untilAborted(Promise.reject(new Error('boom')), controller.signal)
    ).rejects.toThrow('boom')
  })
})
