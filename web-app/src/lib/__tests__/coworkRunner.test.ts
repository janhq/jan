import { describe, it, expect, vi } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'
import {
  runTurn,
  consumeStep,
  assistantMessageFor,
  turnsFor,
  abortRun,
  answerAsk,
  isAbortLike,
  isRetryableSendError,
  isRunning,
  __testing,
  type PendingToolCall,
  type StepResult,
  type ToolOutcome,
} from '../coworkRunner'
import { MAX_SESSION_TOKENS } from '../coworkBudget'

const streamOf = (chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> =>
  new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk)
      c.close()
    },
  })

const textStep = (text: string, usageTotal?: number): UIMessageChunk[] => [
  { type: 'text-delta', id: 't', delta: text } as UIMessageChunk,
  ...(usageTotal !== undefined
    ? ([
        {
          type: 'finish',
          messageMetadata: { usage: { totalTokens: usageTotal } },
        },
      ] as unknown as UIMessageChunk[])
    : []),
]

const toolStep = (name: string, id = 'c1'): UIMessageChunk[] => [
  {
    type: 'tool-input-start',
    toolCallId: id,
    toolName: name,
  } as UIMessageChunk,
  {
    type: 'tool-input-available',
    toolCallId: id,
    toolName: name,
    input: { path: 'a.txt' },
  } as UIMessageChunk,
]

const noopSink = () => ({
  onText: vi.fn(),
  onToolStart: vi.fn(),
  onToolArgsDelta: vi.fn(),
  onToolCall: vi.fn(),
})

const deps = (
  steps: UIMessageChunk[][],
  dispatch = vi.fn(async (): Promise<ToolOutcome> => ({ output: 'ok' }))
) => {
  let i = 0
  return {
    sendStep: vi.fn(async () =>
      streamOf(steps[Math.min(i++, steps.length - 1)])
    ),
    dispatch,
    sink: noopSink(),
    onStep: vi.fn(),
    nextMessageId: (() => {
      let n = 0
      return () => `m${n++}`
    })(),
  }
}

const user = (text: string): UIMessage =>
  ({ id: 'u1', role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

describe('consumeStep', () => {
  it('folds text, tool calls and usage out of the chunk stream', async () => {
    const sink = noopSink()
    const r = await consumeStep(
      streamOf([...textStep('hi'), ...toolStep('read'), ...textStep('', 120)]),
      sink
    )
    expect(r.text).toBe('hi')
    expect(r.toolCalls).toEqual([
      { toolCallId: 'c1', toolName: 'read', input: { path: 'a.txt' } },
    ])
    expect(r.usage?.total_tokens).toBe(120)
    expect(sink.onToolStart).toHaveBeenCalledWith('c1', 'read')
  })

  it('surfaces an error chunk without throwing', async () => {
    const r = await consumeStep(
      streamOf([{ type: 'error', errorText: 'boom' } as UIMessageChunk]),
      noopSink()
    )
    expect(r.errorText).toBe('boom')
  })
})

describe('runTurn', () => {
  it('stops when the model answers without asking for tools', async () => {
    const d = deps([textStep('done')])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('done')
    expect(out.steps).toBe(1)
    expect(d.sendStep).toHaveBeenCalledTimes(1)
  })

  /// A dispatched subagent outlives its tool call, so the answer arrives after
  /// the model has already stopped. Ending there would drop it.
  it('parks instead of finishing while a subagent is still running', async () => {
    const d = deps([textStep('dispatched'), textStep('and here it is')])
    const queue: string[] = []
    let running = 1
    let waits = 0
    const out = await runTurn({
      messages: [user('go')],
      signal: new AbortController().signal,
      deps: {
        ...d,
        inbox: {
          take: () => queue.splice(0, queue.length),
          pending: () => queue.length > 0 || running > 0,
          // Standing in for the child finishing while the parent is parked.
          wait: async () => {
            waits += 1
            queue.push("Subagent 'researcher' finished")
            running -= 1
          },
        },
      },
    })
    expect(out.stoppedBy).toBe('done')
    expect(waits).toBe(1)
    expect(d.sendStep).toHaveBeenCalledTimes(2)
    // The second request carries the ping as a marked user turn, after the
    // answer the model had already given.
    const sent = d.sendStep.mock.calls[1][0] as UIMessage[]
    const last = sent[sent.length - 1]
    expect(last.role).toBe('user')
    expect((last.parts[0] as { text: string }).text).toBe(
      "<SYSTEM>\nSubagent 'researcher' finished\n</SYSTEM>"
    )
    expect(sent[sent.length - 2].role).toBe('assistant')
  })

  /// Two children finishing together take one turn: consecutive user messages
  /// are rejected outright by some providers.
  it('fuses pings that arrive together into one marked turn', async () => {
    const d = deps([textStep('a'), textStep('b')])
    let running = 2
    const queue: string[] = []
    await runTurn({
      messages: [user('go')],
      signal: new AbortController().signal,
      deps: {
        ...d,
        inbox: {
          take: () => queue.splice(0, queue.length),
          pending: () => queue.length > 0 || running > 0,
          wait: async () => {
            queue.push('alpha done', 'beta done')
            running = 0
          },
        },
      },
    })
    const sent = d.sendStep.mock.calls[1][0] as UIMessage[]
    const pings = sent.filter(
      (m) =>
        m.role === 'user' &&
        (m.parts[0] as { text?: string }).text?.startsWith('<SYSTEM>')
    )
    expect(pings).toHaveLength(1)
    expect((pings[0].parts[0] as { text: string }).text).toBe(
      '<SYSTEM>\nalpha done\nbeta done\n</SYSTEM>'
    )
  })

  /// No inbox at all is the subagent path: a child cannot dispatch children, so
  /// nothing should change for it.
  it('finishes normally with no inbox', async () => {
    const d = deps([textStep('done')])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('done')
    expect(d.sendStep).toHaveBeenCalledTimes(1)
  })

  it('keeps stepping while the model asks for tools', async () => {
    const d = deps([toolStep('read'), toolStep('read', 'c2'), textStep('done')])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('done')
    expect(out.steps).toBe(3)
  })

  // Routine, not an error: the caller offers "Keep going" rather than a
  // failure banner, so this must return cleanly instead of throwing.
  it('stops cleanly at the step cap', async () => {
    const d = deps([toolStep('read')])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
      maxSteps: 3,
    })
    expect(out.stoppedBy).toBe('steps')
    expect(out.steps).toBe(3)
  })

  it('stops on the session token budget, counting tokens spent earlier', async () => {
    const d = deps([toolStep('read'), ...[textStep('x')]])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
      sessionTokens: MAX_SESSION_TOKENS,
    })
    expect(out.stoppedBy).toBe('tokens')
    expect(d.sendStep).not.toHaveBeenCalled()
  })

  // Each step's reported total includes the whole replayed prompt, so the spend
  // is the growth between steps, not the sum of the totals (which would be 300
  // here and would trip the cap on a run nowhere near it).
  it('charges only the growth in usage across steps', async () => {
    const d = deps([
      [...toolStep('read'), ...textStep('', 100)],
      textStep('done', 200),
    ])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.sessionTokens).toBe(200)
  })

  it('does not charge a step whose reported total shrank', async () => {
    const d = deps([
      [...toolStep('read'), ...textStep('', 100)],
      textStep('done', 60),
    ])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.sessionTokens).toBe(100)
  })

  it('marks outstanding calls interrupted when aborted mid-dispatch', async () => {
    const ac = new AbortController()
    const dispatch = vi.fn(async (): Promise<ToolOutcome> => {
      ac.abort()
      return { output: 'ok' }
    })
    const d = deps(
      [
        [
          ...toolStep('read', 'c1'),
          {
            type: 'tool-input-available',
            toolCallId: 'c2',
            toolName: 'read',
            input: {},
          } as UIMessageChunk,
        ],
      ],
      dispatch
    )
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: ac.signal,
    })
    expect(out.stoppedBy).toBe('aborted')
    const parts = (out.messages.at(-1) as { parts: any[] }).parts
    expect(parts.find((p) => p.toolCallId === 'c2').errorText).toBe(
      '(interrupted)'
    )
  })

  it('ends the run on an error chunk instead of looping', async () => {
    const d = deps([[{ type: 'error', errorText: 'boom' } as UIMessageChunk]])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('error')
    expect(out.errorText).toBe('boom')
    expect(d.sendStep).toHaveBeenCalledTimes(1)
  })

  it('feeds each step tool results before the next one', async () => {
    const d = deps([toolStep('read'), textStep('done')])
    await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    const secondCall = d.sendStep.mock.calls[1][0] as UIMessage[]
    const parts = (secondCall.at(-1) as { parts: any[] }).parts
    expect(parts[0].state).toBe('output-available')
    expect(parts[0].output).toBe('ok')
  })
})

describe('diff sidecar', () => {
  // A diff is a rendering aid. Sending it to the model doubles the cost of
  // every edit and corrupts the output the tool widget parses.
  it('never reaches the model-facing message', () => {
    const step: StepResult = {
      text: '',
      toolCalls: [
        { toolCallId: 'c1', toolName: 'edit', input: {} } as PendingToolCall,
      ],
      usage: null,
      aborted: false,
    }
    const outcomes = new Map<string, ToolOutcome>([
      ['c1', { output: 'Wrote a.txt', diff: '- old\n+ new' }],
    ])
    const msg = assistantMessageFor('m0', step, outcomes)
    expect(JSON.stringify(msg)).not.toContain('+ new')
    // …but it does reach the transcript row the UI renders.
    expect(turnsFor(step, outcomes)[0].diff).toBe('- old\n+ new')
  })
})

describe('run handles', () => {
  it('aborts the stream, tools, children and pending asks together', () => {
    const h = __testing.createHandle('s1', 'r1')
    const child = new AbortController()
    h.subagents.set('sub1', child)
    const ask = vi.fn()
    h.pendingAsks.set('q1', ask)

    expect(isRunning('s1')).toBe(true)
    abortRun('s1')

    expect(h.outer.signal.aborted).toBe(true)
    expect(h.tools.signal.aborted).toBe(true)
    expect(child.signal.aborted).toBe(true)
    // Resolved as cancelled, not left hanging: the dispatch loop is awaiting it.
    expect(ask).toHaveBeenCalledWith(null)
    expect(isRunning('s1')).toBe(false)
  })

  it('answers a pending ask once and reports an unknown one', () => {
    const h = __testing.createHandle('s2', 'r2')
    const resolve = vi.fn()
    h.pendingAsks.set('q1', resolve)
    expect(answerAsk('s2', 'q1', [{ id: 'q1', selected: ['a'] }])).toBe(true)
    expect(resolve).toHaveBeenCalledOnce()
    expect(answerAsk('s2', 'q1', [])).toBe(false)
    abortRun('s2')
  })

  it('is a no-op for a session that is not running', () => {
    expect(() => abortRun('nope')).not.toThrow()
  })
})

describe('isAbortLike', () => {
  it('recognises the stop the tauri http plugin actually reports', () => {
    expect(isAbortLike(new Error('Request cancelled'))).toBe(true)
    const err = new Error('nope')
    err.name = 'AbortError'
    expect(isAbortLike(err)).toBe(true)
  })

  // A dropped socket says "connection aborted"; reporting that as a user stop
  // would hide a real failure behind a notice that says nothing went wrong.
  it('does not mistake a network failure for a stop', () => {
    expect(isAbortLike(new Error('connection aborted by peer'))).toBe(false)
  })

  it('trusts the signal over the message', () => {
    const c = new AbortController()
    c.abort()
    expect(isAbortLike(new Error('error sending request'), c.signal)).toBe(true)
  })
})

// The failure a long turn invites: while tools run locally no bytes flow, the
// peer reclaims the idle keep-alive connection, and the next step's request is
// written into a socket that is already gone. Mirrors the Rust agent's
// send_with_one_retry — retrying is safe precisely because nothing was
// received.
describe('dropped-connection retry', () => {
  it('retries a dropped send once and the step succeeds', async () => {
    let first = true
    const d = deps([textStep('done')])
    const send = d.sendStep.getMockImplementation()!
    d.sendStep.mockImplementation(async (...args) => {
      if (first) {
        first = false
        throw new Error('connection reset by peer (os error 104)')
      }
      return send(...(args as []))
    })
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('done')
    expect(d.sendStep).toHaveBeenCalledTimes(2)
  })

  it('retries exactly once, then reports the failure', async () => {
    const d = {
      ...deps([[]]),
      sendStep: vi.fn(async () => {
        throw new Error('connection reset by peer')
      }),
    }
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('error')
    expect(out.errorText).toContain('connection reset')
    expect(d.sendStep).toHaveBeenCalledTimes(2)
  })

  // An error chunk before any delta is the same dropped connection, surfaced
  // through the stream instead of a rejection — streamText reports transport
  // failures this way.
  it('retries an error chunk that arrived before anything streamed', async () => {
    const d = deps([
      [
        {
          type: 'error',
          errorText: 'connection closed before message completed',
        } as UIMessageChunk,
      ],
      textStep('done'),
    ])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('done')
    expect(d.sendStep).toHaveBeenCalledTimes(2)
  })

  // Tokens already reached the UI; replaying the request would duplicate them.
  it('never retries once something has streamed', async () => {
    const d = deps([
      [
        ...textStep('partial'),
        {
          type: 'error',
          errorText: 'connection reset by peer',
        } as UIMessageChunk,
      ],
    ])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('error')
    expect(d.sendStep).toHaveBeenCalledTimes(1)
  })

  it('does not retry a timeout: retrying one doubles the wait', async () => {
    const d = {
      ...deps([[]]),
      sendStep: vi.fn(async () => {
        throw new Error('error sending request: operation timed out')
      }),
    }
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('error')
    expect(d.sendStep).toHaveBeenCalledTimes(1)
  })
})

describe('isRetryableSendError', () => {
  it('recognises the stale keep-alive family and failed connects', () => {
    for (const msg of [
      'connection closed before message completed',
      'Connection reset by peer (os error 104)',
      'broken pipe',
      'connection aborted',
      'unexpected EOF during handshake',
      'connection refused',
      'error sending request for url (http://x/v1/chat/completions)',
      'TypeError: Failed to fetch',
    ]) {
      expect(isRetryableSendError(msg), msg).toBe(true)
    }
  })

  it('refuses timeouts, upstream rejections and plain errors', () => {
    for (const msg of [
      'error sending request: operation timed out',
      'Request timeout',
      '400 Bad Request: model not found',
      'boom',
    ]) {
      expect(isRetryableSendError(msg), msg).toBe(false)
    }
  })
})

describe('runTurn failure paths', () => {
  const throwingDeps = (error: unknown) => ({
    ...deps([[]]),
    sendStep: vi.fn(async () => {
      throw error
    }),
  })

  it('reports a stop as an outcome instead of throwing', async () => {
    const c = new AbortController()
    const d = throwingDeps(new Error('Request cancelled'))
    c.abort()
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: c.signal,
    })
    expect(out.stoppedBy).toBe('aborted')
    expect(out.errorText).toBeUndefined()
  })

  it('reports a transport failure as an outcome, message intact', async () => {
    const d = throwingDeps(new Error('error sending request for url (…)'))
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('error')
    expect(out.errorText).toContain('error sending request')
    // Nothing to replay: the model never answered, so no assistant turn exists.
    expect(out.messages).toHaveLength(1)
  })

  // An assistant message with no parts is a turn the model never took, and the
  // next request would replay it as one.
  it('appends no assistant message for a step that produced nothing', async () => {
    const d = deps([[{ type: 'error', errorText: 'boom' } as UIMessageChunk]])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.stoppedBy).toBe('error')
    expect(out.messages).toHaveLength(1)
  })
})
