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
  toolErrorsOf,
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

  // Older messages hold calls that failed or were denied before this release
  // saved their error; relabelling them "stopped" would be wrong, and the model
  // reads them on later turns.
  it('settles only the last message, never earlier history', () => {
    const old = { ...assistant([tool('input-available')]), id: 'old' }
    const current = {
      ...assistant([tool('input-streaming', { toolCallId: 'c2' })]),
      id: 'cur',
    }
    const out = settleStoppedToolCalls([old, current])
    expect(out[0]).toBe(old)
    expect(out[1].parts[0]).toMatchObject({ state: 'output-error' })
  })

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

  it('reloads a stopped call as an error, not as running or as a result', () => {
    const [stopped] = settleStoppedToolCalls([
      assistant([tool('input-streaming')]),
    ])
    const reloaded = convertThreadMessageToUIMessage({
      id: 'a1',
      role: 'assistant',
      content: extractContentPartsFromUIMessage(stopped),
      metadata: { toolErrors: toolErrorsOf(stopped) },
    } as Parameters<typeof convertThreadMessageToUIMessage>[0])
    // `input-available` is what renders "Running"; `output-available` would
    // present the stop as a result the tool returned.
    expect(reloaded.parts[0]).toMatchObject({
      state: 'output-error',
      errorText: STOPPED_TOOL_ERROR,
    })
  })

  it('reloads a denied call as an error too', () => {
    const denied = assistant([
      tool('output-error', { errorText: 'Tool execution denied by user' }),
    ])
    expect(toolErrorsOf(denied)).toEqual({
      c1: 'Tool execution denied by user',
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
