import { describe, it, expect, vi } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'
import {
  runTurn,
  consumeStep,
  assistantMessageFor,
  turnsFor,
  abortRun,
  answerAsk,
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
  { type: 'tool-input-start', toolCallId: id, toolName: name } as UIMessageChunk,
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
    sendStep: vi.fn(async () => streamOf(steps[Math.min(i++, steps.length - 1)])),
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

  it('accumulates usage across steps into the session total', async () => {
    const d = deps([
      [...toolStep('read'), ...textStep('', 100)],
      textStep('done', 50),
    ])
    const out = await runTurn({
      messages: [user('hi')],
      deps: d,
      signal: new AbortController().signal,
    })
    expect(out.sessionTokens).toBe(150)
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
