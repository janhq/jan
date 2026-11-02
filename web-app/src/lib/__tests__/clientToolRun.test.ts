import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tool, UIMessageChunk } from 'ai'
import type { AskAnswer } from '@/types/coworkSession'

// Fail closed: this suite must never reach native, provider, or web services.
const native = vi.hoisted(() => ({
  executeAgentTool: vi.fn(), startAgentMonitor: vi.fn(),
  stopAgentMonitor: vi.fn(), listAgentMonitors: vi.fn(),
}))
const web = vi.hoisted(() => ({ executeWebTool: vi.fn() }))
vi.mock('@/lib/agentTools', () => native)
vi.mock('@/lib/webSearchTool', () => ({
  WEB_TOOL_NAMES: new Set(['web_search', 'web_fetch']), ...web,
}))
vi.mock('@/hooks/useCoworkConfig', () => ({
  useCoworkConfig: { getState: () => ({ networkEnabled: false }) },
}))

import { dispatchCoworkTool, type DispatchContext } from '../coworkDispatch'
import {
  abortRun, answerAsk, createHandle, getRunHandle, releaseHandle, runTurn,
  type PendingToolCall, type RunDeps, type ToolOutcome,
} from '../coworkRunner'

const sid = 'synthetic-client-tool-run'
const call = (toolName: string, toolCallId: string): PendingToolCall => ({
  toolName, toolCallId, input: { fixture: toolCallId },
})
const text = (delta: string): UIMessageChunk => ({ type: 'text-delta', id: 'text', delta })
const chunks = (...calls: PendingToolCall[]): UIMessageChunk[] => calls.flatMap((c) => [
  { type: 'tool-input-start', toolCallId: c.toolCallId, toolName: c.toolName },
  { type: 'tool-input-delta', toolCallId: c.toolCallId, inputTextDelta: JSON.stringify(c.input) },
  { type: 'tool-input-available', ...c },
] as UIMessageChunk[])
const context = (): DispatchContext => ({
  advertisedTools: Object.freeze(Object.fromEntries(
    ['todo', 'ask', 'task', 'monitor'].map((name) => [name, {} as Tool])
  )),
  sessionId: sid, readOnlyFolder: null, planMode: false, webSearch: false,
  monitors: null,
  onTodo: vi.fn(async () => ({ output: 'todo result' })),
  onAsk: vi.fn(async () => ({ output: 'approved' })),
  onTask: vi.fn(async () => ({ output: 'task result' })),
})
function fixture(steps: UIMessageChunk[][], ctx = context()) {
  let cursor = 0
  let id = 0
  const deps: RunDeps = {
    sendStep: vi.fn(async () => {
      const step = steps[cursor++]
      if (!step) throw new Error('unexpected extra synthetic model call')
      return new ReadableStream({ start(c) { step.forEach((v) => c.enqueue(v)); c.close() } })
    }),
    dispatch: vi.fn((c) => dispatchCoworkTool(c, ctx)),
    sink: {
      onText: vi.fn(), onReasoning: vi.fn(), onToolStart: vi.fn(),
      onToolArgsDelta: vi.fn(), onToolCall: vi.fn(),
    },
    onStep: vi.fn(), nextMessageId: () => `synthetic-assistant-${id++}`,
  }
  return { ctx, deps, start: (signal = new AbortController().signal) => runTurn({
    messages: [{ id: 'synthetic-user', role: 'user', parts: [{ type: 'text', text: 'fixture' }] }],
    deps, signal,
  }) }
}

// A conversation-owned stand-in for CoworkPage's promise registration, not a
// second implementation of dispatch. Real answerAsk/abortRun settle the map.
function pendingApproval(ctx: DispatchContext) {
  const handle = createHandle(sid, 'synthetic-run')
  const settled = vi.fn()
  ctx.onAsk = vi.fn((id) => new Promise<ToolOutcome>((resolve) => {
    handle.pendingAsks.set(id, (answers) => {
      settled(answers)
      resolve(answers === null
        ? { output: '(interrupted)', isError: true }
        : { output: 'approved' })
    })
  }))
  return { handle, settled }
}

beforeEach(() => {
  for (const mock of [...Object.values(native), ...Object.values(web)]) {
    mock.mockReset().mockImplementation(() => { throw new Error('external side effect forbidden') })
  }
})
afterEach(() => {
  abortRun(sid)
  for (const mock of [...Object.values(native), ...Object.values(web)]) expect(mock).not.toHaveBeenCalled()
})

describe('runTurn through the real Cowork/client dispatch seam', () => {
  it('answers directly with exactly one model call and no dispatch', async () => {
    const f = fixture([[text('direct answer')]])
    const out = await f.start()
    expect(out.stoppedBy).toBe('done')
    expect(out.steps).toBe(1)
    expect(f.deps.sendStep).toHaveBeenCalledOnce()
    expect(f.deps.dispatch).not.toHaveBeenCalled()
    expect(out.messages[1].parts).toEqual([{ type: 'text', text: 'direct answer' }])
  })

  it('awaits tools serially, retains events/results and unique IDs without mutating advertisement', async () => {
    const ctx = context()
    let resolveTodo!: (outcome: ToolOutcome) => void
    ctx.onTodo = vi.fn(() => new Promise((resolve) => { resolveTodo = resolve }))
    const calls = [call('todo', 'todo-1'), call('task', 'task-2'), call('monitor', 'monitor-3')]
    const f = fixture([[text('working'), ...chunks(...calls)], [text('finished')]], ctx)
    const advertised = ctx.advertisedTools
    const advertisedJSON = JSON.stringify(advertised)
    const pending = f.start()
    await vi.waitFor(() => expect(ctx.onTodo).toHaveBeenCalledOnce())
    expect(ctx.onTask).not.toHaveBeenCalled()
    expect(f.deps.sendStep).toHaveBeenCalledOnce()
    resolveTodo({ output: 'todo result', diff: '-old\n+new' })
    const out = await pending
    expect(out.stoppedBy).toBe('done')
    expect(f.deps.sendStep).toHaveBeenCalledTimes(2)
    expect(ctx.onTask).toHaveBeenCalledExactlyOnceWith('task-2', calls[1].input)
    expect(vi.mocked(f.deps.dispatch).mock.calls.map(([c]) => c)).toEqual(calls)
    expect(vi.mocked(f.deps.sink.onToolCall).mock.calls.map(([c]) => c)).toEqual(calls)
    expect(f.deps.sink.onToolStart).toHaveBeenCalledTimes(3)
    expect(f.deps.sink.onToolArgsDelta).toHaveBeenCalledTimes(3)
    expect(vi.mocked(f.deps.sink.onText).mock.calls.flat()).toEqual(['working', 'finished'])
    const committed = vi.mocked(f.deps.onStep).mock.calls[0][0]
    expect(committed.turns.filter((t) => t.role === 'tool').map((t) => t.callId)).toEqual(calls.map((c) => c.toolCallId))
    expect(committed.outcomes.get('todo-1')).toEqual({ output: 'todo result', diff: '-old\n+new' })
    expect(committed.outcomes.get('monitor-3')?.isError).toBe(true)
    expect(out.messages[1].parts[1]).toMatchObject({ toolCallId: 'todo-1', output: 'todo result' })
    expect(JSON.stringify(out.messages)).not.toContain('-old')
    expect(new Set(out.messages.map((m) => m.id)).size).toBe(out.messages.length)
    expect(vi.mocked(f.deps.sendStep).mock.calls[1][0][1]).toEqual(out.messages[1])
    expect(ctx.advertisedTools).toBe(advertised)
    expect(JSON.stringify(advertised)).toBe(advertisedJSON)
  })

  it('pauses for approval, settles once and resumes only after the answer', async () => {
    const ctx = context()
    const { handle, settled } = pendingApproval(ctx)
    const f = fixture([chunks(call('ask', 'approval-1')), [text('approved answer')]], ctx)
    const pending = f.start(handle.outer.signal)
    await vi.waitFor(() => expect(handle.pendingAsks.size).toBe(1))
    expect(f.deps.sendStep).toHaveBeenCalledOnce()
    expect(f.deps.onStep).not.toHaveBeenCalled()
    const answers: AskAnswer[] = [{ id: 'fixture', selected: ['approve'] }]
    expect(answerAsk(sid, 'approval-1', answers)).toBe(true)
    expect(answerAsk(sid, 'approval-1', answers)).toBe(false)
    expect((await pending).stoppedBy).toBe('done')
    expect(settled).toHaveBeenCalledExactlyOnceWith(answers)
    expect(handle.pendingAsks.size).toBe(0)
    expect(ctx.onAsk).toHaveBeenCalledOnce()
    expect(f.deps.sendStep).toHaveBeenCalledTimes(2)
    releaseHandle(sid, handle)
  })

  it('Stop resolves a suspended promise once, aborts all lanes and never dispatches the next tool', async () => {
    const ctx = context()
    const { handle, settled } = pendingApproval(ctx)
    const child = new AbortController()
    handle.subagents.set('synthetic-child', child)
    const f = fixture([chunks(call('ask', 'approval-stop'), call('task', 'never-run'))], ctx)
    const pending = f.start(handle.outer.signal)
    await vi.waitFor(() => expect(handle.pendingAsks.size).toBe(1))
    abortRun(sid)
    abortRun(sid)
    const out = await pending
    expect(out.stoppedBy).toBe('aborted')
    expect(settled).toHaveBeenCalledExactlyOnceWith(null)
    expect(answerAsk(sid, 'approval-stop', [])).toBe(false)
    expect(handle.pendingAsks.size).toBe(0)
    expect(getRunHandle(sid)).toBeUndefined()
    expect(handle.outer.signal.aborted && handle.tools.signal.aborted && child.signal.aborted).toBe(true)
    expect(ctx.onTask).not.toHaveBeenCalled()
    expect(f.deps.sendStep).toHaveBeenCalledOnce()
    const outcomes = vi.mocked(f.deps.onStep).mock.calls[0][0].outcomes
    expect(outcomes.get('approval-stop')).toEqual({ output: '(interrupted)', isError: true })
    expect(outcomes.get('never-run')).toEqual({ output: '(interrupted)', isError: true })
  })

  it('normalizes a rejected client promise once with no retry or unhandled rejection', async () => {
    const ctx = context()
    ctx.onAsk = vi.fn().mockRejectedValue(new Error('synthetic rejection'))
    const f = fixture([chunks(call('ask', 'rejected-ask')), [text('recovered')]], ctx)
    const out = await f.start()
    expect(out.stoppedBy).toBe('done')
    expect(ctx.onAsk).toHaveBeenCalledOnce()
    expect(vi.mocked(f.deps.onStep).mock.calls[0][0].outcomes.get('rejected-ask'))
      .toEqual({ output: 'synthetic rejection', isError: true })
    expect(f.deps.sendStep).toHaveBeenCalledTimes(2)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
