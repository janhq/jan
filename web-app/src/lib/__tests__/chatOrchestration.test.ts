import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tool, UIMessageChunk } from 'ai'

const hoisted = vi.hoisted(() => ({
  childStep: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  stopAll: vi.fn(),
  list: vi.fn(),
}))

vi.mock('../coworkSubagent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../coworkSubagent')>()),
  childStep: hoisted.childStep,
}))
vi.mock('../agentTools', () => ({
  startThreadAgentMonitor: hoisted.start,
  stopThreadAgentMonitor: hoisted.stop,
  stopAllThreadAgentMonitors: hoisted.stopAll,
  listThreadAgentMonitors: hoisted.list,
}))

import {
  CHAT_MAX_CHILDREN_PER_CALL,
  CHAT_MAX_CONCURRENT_CHILDREN,
  __testing,
  acquire,
  cancelChatOrchestration,
  chatRunInbox,
  childEffectiveGrant,
  runChatMonitor,
  runChatTask,
  settleChatRun,
  takeTaskStatus,
  TASK_STATUS_TEXT_LIMIT,
  TASK_STATUS_TRUNCATION_MARKER,
  truncateUtf16,
  CHAT_CHILD_AGGREGATE_SPEND_TOKENS,
  CHAT_CHILD_MAX_SPEND_TOKENS,
  CHAT_CHILD_MAX_COMPLETION_TOKENS,
  type ChildBinding,
  type ChatOrchestrationContext,
} from '../chatOrchestration'
import { dropConversationClientThread } from '../conversationClientTools'
import { defaultConversationCapabilities } from '../conversationCapabilities'
import { createChatRunStream, taskStatusRows } from '../chatRunTransport'
import { readUIMessageStream } from 'ai'
import { resolveScopedChatToolPolicy } from '../scopedChatToolPolicy'

const tool = {} as Tool
const grant = (over: Record<string, unknown>) => ({ ...defaultConversationCapabilities(), ...over })
const streamOf = (chunks: unknown[]) =>
  new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const x of chunks) c.enqueue(x as UIMessageChunk)
      c.close()
    },
  })
const textStep = (t: string) => streamOf([{ type: 'text-delta', id: 't', delta: t }])
const callStep = (name: string, id = 'k1', input: unknown = {}) =>
  streamOf([
    { type: 'tool-input-start', toolCallId: id, toolName: name },
    { type: 'tool-input-available', toolCallId: id, toolName: name, input },
  ])

const PARENT: Record<string, Tool> = Object.fromEntries(
  ['read', 'ls', 'shell', 'write', 'memory', 'skill_write', 'task', 'todo', 'ask', 'monitor'].map((n) => [n, tool])
)

let seq = 0
const ctxFor = (over: Partial<ChatOrchestrationContext> = {}) => {
  const controller = new AbortController()
  const dispatch = vi.fn(async () => ({ output: 'done' }))
  const ctx: ChatOrchestrationContext = {
    threadId: `t${++seq}`,
    signal: controller.signal,
    getParentTools: () => PARENT,
    getModel: () => ({}) as never,
    readGrant: () => grant({}),
    serverFor: () => undefined,
    dispatch,
    ...over,
  }
  return { ctx, controller, dispatch }
}
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}
const oneChild = (extra: Record<string, unknown> = {}) => ({
  subagents: [{ name: 'a', task: 'go', ...extra }],
})

beforeEach(() => {
  hoisted.childStep.mockReset()
  hoisted.start.mockReset()
  hoisted.stop.mockReset().mockResolvedValue('Stopped monitor')
  hoisted.stopAll.mockReset().mockResolvedValue(undefined)
  hoisted.list.mockReset()
})

describe('bounded child tools', () => {
  it('advertises only the narrowed set; withheld recursive tools are refused before dispatch', async () => {
    const { ctx, dispatch } = ctxFor()
    const offered: string[][] = []
    let step = 0
    hoisted.childStep.mockImplementation(async (o: { tools: Record<string, Tool> }) => {
      offered.push(Object.keys(o.tools).sort())
      step++
      if (step === 1) return callStep('memory', 'm1')
      if (step === 2) return callStep('task', 't1')
      if (step === 3) return callStep('todo', 'd1')
      if (step === 4) return callStep('ask', 'a1')
      if (step === 5) return callStep('monitor', 'n1')
      if (step === 6) return callStep('read', 'r1')
      return textStep('finished')
    })
    const out = await runChatTask(oneChild(), 'call', ctx)
    expect(out.isError).toBeUndefined()
    await settle(60)
    expect(offered[0]).toEqual(['ls', 'read', 'shell', 'skill_write', 'write'])
    // Only the one allowed native call reached the route dispatch.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect((dispatch.mock.calls[0] as unknown[])[0]).toMatchObject({ toolName: 'read' })
  })

  it('an allowlist cannot widen past the parent record: a withheld name yields no tool', async () => {
    const { ctx } = ctxFor()
    hoisted.childStep.mockImplementation(async () => textStep('ok'))
    await runChatTask(oneChild({ allowed_tools: ['memory', 'task'] }), 'c', ctx)
    await settle()
    expect(Object.keys((hoisted.childStep.mock.calls[0][0] as { tools: object }).tools)).toEqual([])
  })

  it('caps children per call', async () => {
    const { ctx } = ctxFor()
    const subagents = Array.from({ length: CHAT_MAX_CHILDREN_PER_CALL + 1 }, (_, i) => ({ name: `c${i}`, task: 'x' }))
    expect((await runChatTask({ subagents }, 'c', ctx)).isError).toBe(true)
  })
})

describe('parent grant frozen at dispatch', () => {
  it('passes the grant frozen at task time (and frozen MCP identity) to every child dispatch', async () => {
    let live: unknown = grant({ folderScope: { path: '/p', access: 'read' } })
    let server: string | undefined = 'srvA'
    const { ctx, dispatch } = ctxFor({ readGrant: () => live, serverFor: () => server })
    let step = 0
    hoisted.childStep.mockImplementation(async () => (step++ === 0 ? callStep('read', 'r1') : textStep('ok')))
    await runChatTask(oneChild(), 'call', ctx)
    // Widen + rebind AFTER dispatch, before the child's tool call lands.
    live = grant({ folderScope: { path: '/p', access: 'write' }, shellNetwork: true, memoryWrite: true })
    server = 'evil'
    await settle(40)
    const binding = (dispatch.mock.calls[0] as unknown[])[2] as ChildBinding
    expect(binding.mcpServers.get('read')).toBe('srvA')
    // Widened current grant is cut back to the frozen ceiling.
    expect(childEffectiveGrant(live, binding)).toMatchObject({
      folderScope: { path: '/p', access: 'read' },
      shellNetwork: false,
      memoryWrite: false,
    })
  })

  it('revoke after dispatch still narrows, widening never expands', () => {
    const binding = { ceiling: grant({ folderScope: { path: '/p', access: 'write' }, shellNetwork: true }), mcpServers: new Map() }
    expect(childEffectiveGrant(grant({}), binding)).toMatchObject({ folderScope: null, shellNetwork: false })
    expect(childEffectiveGrant(grant({ folderScope: { path: '/other', access: 'write' } }), binding)).toMatchObject({ folderScope: null })
    const narrow = { ceiling: grant({}), mcpServers: new Map() }
    expect(childEffectiveGrant(grant({ folderScope: { path: '/p', access: 'write' }, memoryWrite: true }), narrow))
      .toMatchObject({ folderScope: null, memoryWrite: false, shellNetwork: false })
  })
})

describe('semaphore waiters', () => {
  it('an aborted queued waiter leaves the queue and never takes a slot', async () => {
    const state = { active: 0, waiters: [] as Array<() => void> }
    const live = new AbortController()
    const releases = []
    for (let i = 0; i < CHAT_MAX_CONCURRENT_CHILDREN; i++) releases.push((await acquire(state, live.signal))!)
    const queued = new AbortController()
    const waiting = acquire(state, queued.signal)
    expect(state.waiters).toHaveLength(1)
    queued.abort()
    expect(await waiting).toBeNull()
    expect(state.waiters).toHaveLength(0)
    releases.forEach((r) => r())
    expect(state.active).toBe(0)
  })

  it('a released slot is handed to the next live waiter exactly once', async () => {
    const state = { active: 0, waiters: [] as Array<() => void> }
    const s = new AbortController().signal
    const r1 = (await acquire(state, s))!
    await acquire(state, s)
    const next = acquire(state, s)
    r1(); r1()
    const r3 = (await next)!
    expect(state.active).toBe(CHAT_MAX_CONCURRENT_CHILDREN)
    r3()
    expect(state.active).toBe(CHAT_MAX_CONCURRENT_CHILDREN - 1)
  })

  it('a stopped parent leaks no queued child and no inbox hold', async () => {
    const { ctx, controller, dispatch } = ctxFor()
    const gates: Array<() => void> = []
    hoisted.childStep.mockImplementation(
      (o: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          gates.push(() => resolve(textStep('late')))
          o.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
    )
    await runChatTask({ subagents: [1, 2, 3].map((i) => ({ name: `c${i}`, task: 'x' })) }, 'call', ctx)
    await settle()
    const state = __testing.stateOf(ctx.threadId)
    expect(state.active).toBe(CHAT_MAX_CONCURRENT_CHILDREN)
    expect(state.waiters).toHaveLength(1)
    controller.abort()
    await settle(40)
    expect(state.waiters).toHaveLength(0)
    expect(state.active).toBe(0)
    expect(state.children.size).toBe(0)
    expect(chatRunInbox(ctx.threadId).pending()).toBe(false)
    expect(chatRunInbox(ctx.threadId).take()).toEqual([])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('a deleted thread drops its state and queued children never run', async () => {
    const { ctx } = ctxFor()
    hoisted.childStep.mockImplementation(() => new Promise(() => {}))
    await runChatTask({ subagents: [1, 2, 3].map((i) => ({ name: `c${i}`, task: 'x' })) }, 'call', ctx)
    await settle()
    const state = __testing.stateOf(ctx.threadId)
    dropConversationClientThread(ctx.threadId)
    await settle()
    expect(__testing.threads.has(ctx.threadId)).toBe(false)
    expect(state.waiters).toHaveLength(0)
    expect(hoisted.stopAll).toHaveBeenCalledWith(ctx.threadId)
  })
})

describe('task result + inbox', () => {
  it('returns a dispatch receipt and delivers the completion through the single inbox lane', async () => {
    const { ctx } = ctxFor()
    hoisted.childStep.mockImplementation(async () => textStep('the answer'))
    const out = await runChatTask(oneChild(), 'call', ctx)
    expect(out.isError).toBeUndefined()
    expect(out.output).toMatch(/a/)
    expect(out.output).not.toContain('the answer')
    const inbox = chatRunInbox(ctx.threadId)
    expect(inbox.pending()).toBe(true)
    await inbox.wait(new AbortController().signal)
    const taken = inbox.take()
    expect(taken).toHaveLength(1)
    expect(taken[0]).toContain('the answer')
    expect(inbox.take()).toEqual([])
    await settle()
    expect(inbox.pending()).toBe(false)
  })
})

describe('monitor host boundary', () => {
  const started = (id = 'mon-1') => ({ output: `Started. monitor_id=${id}` })

  it('start/list/stop call the host with only threadId, args, onUpdate', async () => {
    const { ctx } = ctxFor()
    hoisted.start.mockResolvedValue(started())
    hoisted.list.mockResolvedValue('mon-1 running')
    const args = { op: 'start', name: 'w', script: 'x' }
    expect((await runChatMonitor(args, ctx)).output).toContain('mon-1')
    expect(hoisted.start).toHaveBeenCalledWith(ctx.threadId, args, expect.any(Function))
    expect(hoisted.start.mock.calls[0]).toHaveLength(3)
    expect((await runChatMonitor({ op: 'list' }, ctx)).output).toBe('mon-1 running')
    expect(hoisted.list).toHaveBeenCalledWith(ctx.threadId)
    expect((await runChatMonitor({ op: 'stop', monitor_id: 'mon-1' }, ctx)).isError).toBe(false)
    expect(hoisted.stop).toHaveBeenCalledWith(ctx.threadId, 'mon-1')
    expect(__testing.stateOf(ctx.threadId).monitorIds.size).toBe(0)
  })

  it('a ping queues once on the shared inbox without starting a second loop', async () => {
    const { ctx } = ctxFor()
    let push: (u: unknown) => void = () => {}
    hoisted.start.mockImplementation(async (_t: string, _a: unknown, cb: (u: unknown) => void) => {
      push = cb
      return started()
    })
    await runChatMonitor({ op: 'start' }, ctx)
    const inbox = chatRunInbox(ctx.threadId)
    // A running monitor never parks the run.
    expect(inbox.pending()).toBe(false)
    expect(__testing.stateOf(ctx.threadId).lane.onPing).toBeNull()
    push({ monitorId: 'mon-1', headline: 'hit', text: 'file changed' })
    expect(inbox.pending()).toBe(true)
    expect(inbox.take()).toEqual(['file changed'])
    expect(inbox.take()).toEqual([])
    expect(hoisted.childStep).not.toHaveBeenCalled()
    expect(__testing.stateOf(ctx.threadId).monitorIds.size).toBe(0)
  })

  it('Stop cancels only owned monitors and later callbacks never ping', async () => {
    const { ctx } = ctxFor()
    let push: (u: unknown) => void = () => {}
    hoisted.start.mockImplementation(async (_t: string, _a: unknown, cb: (u: unknown) => void) => {
      push = cb
      return started('mon-9')
    })
    await runChatMonitor({ op: 'start' }, ctx)
    await cancelChatOrchestration(ctx.threadId)
    expect(hoisted.stop).toHaveBeenCalledWith(ctx.threadId, 'mon-9')
    push({ monitorId: 'mon-9', headline: 'late', text: 'stale' })
    expect(chatRunInbox(ctx.threadId).pending()).toBe(false)
    expect(chatRunInbox(ctx.threadId).take()).toEqual([])
    // Another thread's monitors are untouched.
    expect(hoisted.stop).toHaveBeenCalledTimes(1)
  })

  it('a start that resolves after Stop is stopped on the host and reported refused', async () => {
    const { ctx } = ctxFor()
    let resolveStart: (v: unknown) => void = () => {}
    hoisted.start.mockImplementation(() => new Promise((r) => (resolveStart = r)))
    const pending = runChatMonitor({ op: 'start' }, ctx)
    await settle(2)
    await cancelChatOrchestration(ctx.threadId)
    resolveStart(started('mon-3'))
    expect((await pending).isError).toBe(true)
    expect(hoisted.stop).toHaveBeenCalledWith(ctx.threadId, 'mon-3')
  })

  it('thread deletion stops all host monitors and drops callbacks', async () => {
    const { ctx } = ctxFor()
    let push: (u: unknown) => void = () => {}
    hoisted.start.mockImplementation(async (_t: string, _a: unknown, cb: (u: unknown) => void) => {
      push = cb
      return started()
    })
    await runChatMonitor({ op: 'start' }, ctx)
    dropConversationClientThread(ctx.threadId)
    expect(hoisted.stopAll).toHaveBeenCalledWith(ctx.threadId)
    push({ monitorId: 'mon-1', headline: 'x', text: 'stale' })
    expect(__testing.threads.has(ctx.threadId)).toBe(false)
  })
})

describe('advertisement', () => {
  const on = { modelSupportsTools: true, sandboxAvailable: true }
  it('task needs the gate; monitor needs folder consent', () => {
    expect(resolveScopedChatToolPolicy(on, grant({})).advertisedOrchestrationTools).toEqual(['task'])
    expect(resolveScopedChatToolPolicy(on, grant({ folderScope: { path: '/p', access: 'read' } })).advertisedOrchestrationTools)
      .toEqual(['task', 'monitor'])
    expect(resolveScopedChatToolPolicy({ ...on, sandboxAvailable: false }, grant({})).advertisedOrchestrationTools).toEqual([])
  })
})

const hang = () =>
  hoisted.childStep.mockImplementation(
    (o: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        o.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
  )
const lastStatus = (rows: Array<{ runId: string; status: string }>) =>
  Object.fromEntries(rows.map((r) => [r.runId, r.status]))

describe('task status lifecycle', () => {
  it('run abort makes running rows terminal synchronously, before any async child cleanup', async () => {
    const { ctx, controller } = ctxFor()
    hang()
    await runChatTask(oneChild(), 'call', ctx)
    await settle()
    expect(Object.values(lastStatus(takeTaskStatus(ctx.threadId)))).toEqual(['running'])
    controller.abort()
    // No await: the abort listener alone must have settled the row.
    const rows = takeTaskStatus(ctx.threadId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'error', error: '(the subagent was cancelled)' })
    await settle(40)
    expect(takeTaskStatus(ctx.threadId)).toEqual([])
  })

  it('Stop (cancelChatOrchestration) settles running rows before aborting children', async () => {
    const { ctx } = ctxFor()
    hang()
    await runChatTask(oneChild(), 'call', ctx)
    await settle()
    takeTaskStatus(ctx.threadId)
    await cancelChatOrchestration(ctx.threadId)
    const rows = takeTaskStatus(ctx.threadId)
    expect(rows.map((r) => r.status)).toEqual(['error'])
    await settle(40)
    expect(takeTaskStatus(ctx.threadId)).toEqual([])
  })

  it('settleChatRun aborts held children and terminates rows without bumping epoch or stopping monitors', async () => {
    const { ctx } = ctxFor()
    hang()
    await runChatTask(oneChild(), 'call', ctx)
    await settle()
    takeTaskStatus(ctx.threadId)
    const state = __testing.stateOf(ctx.threadId)
    const epoch = state.epoch
    settleChatRun(ctx.threadId)
    expect(takeTaskStatus(ctx.threadId).map((r) => r.status)).toEqual(['error'])
    expect(state.epoch).toBe(epoch)
    expect(hoisted.stop).not.toHaveBeenCalled()
    expect(hoisted.stopAll).not.toHaveBeenCalled()
    await settle(40)
    expect(state.children.size).toBe(0)
    expect(state.active).toBe(0)
  })

  it('a completed child is never downgraded by a later settle', async () => {
    const { ctx } = ctxFor()
    hoisted.childStep.mockImplementation(async () => textStep('fine'))
    await runChatTask(oneChild(), 'call', ctx)
    await settle()
    const first = lastStatus(takeTaskStatus(ctx.threadId))
    expect(Object.values(first)).toEqual(['done'])
    settleChatRun(ctx.threadId)
    expect(takeTaskStatus(ctx.threadId)).toEqual([])
  })

  it('per-run settle leaves another run\'s running rows alone', async () => {
    const a = ctxFor()
    const b = ctxFor({ threadId: a.ctx.threadId })
    hang()
    await runChatTask(oneChild(), 'a', a.ctx)
    await runChatTask(oneChild({ name: 'b' }), 'b', b.ctx)
    await settle()
    takeTaskStatus(a.ctx.threadId)
    a.controller.abort()
    const rows = takeTaskStatus(a.ctx.threadId)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('error')
    expect(rows[0].runId).toContain('a')
    b.controller.abort()
  })

  it('bounds persisted child output and error text', async () => {
    const { ctx } = ctxFor()
    hoisted.childStep.mockImplementation(async () => textStep('x'.repeat(TASK_STATUS_TEXT_LIMIT + 5000)))
    await runChatTask(oneChild(), 'call', ctx)
    await settle()
    const done = takeTaskStatus(ctx.threadId).find((r) => r.status === 'done')
    expect(done?.finalOutput?.length).toBe(TASK_STATUS_TEXT_LIMIT)
    expect(done?.finalOutput?.endsWith(TASK_STATUS_TRUNCATION_MARKER)).toBe(true)
  })

  it('truncation never splits a surrogate pair at the boundary and stays within the limit', () => {
    const keep = TASK_STATUS_TEXT_LIMIT - TASK_STATUS_TRUNCATION_MARKER.length
    // The emoji (2 units) straddles the cut: its high half is the last kept unit.
    const straddle = 'a'.repeat(keep - 1) + '😀' + 'b'.repeat(50)
    const cut = truncateUtf16(straddle, TASK_STATUS_TEXT_LIMIT, TASK_STATUS_TRUNCATION_MARKER)
    expect(cut.length).toBeLessThanOrEqual(TASK_STATUS_TEXT_LIMIT)
    expect(cut).toBe('a'.repeat(keep - 1) + TASK_STATUS_TRUNCATION_MARKER)
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(cut)).toBe(false)
    // Emoji wholly inside the kept prefix survives intact.
    const inside = 'a'.repeat(keep - 2) + '😀' + 'b'.repeat(50)
    expect(truncateUtf16(inside, TASK_STATUS_TEXT_LIMIT, TASK_STATUS_TRUNCATION_MARKER)).toBe(
      'a'.repeat(keep - 2) + '😀' + TASK_STATUS_TRUNCATION_MARKER
    )
    // At or under the limit: untouched, no marker.
    const exact = '😀'.repeat(TASK_STATUS_TEXT_LIMIT / 2)
    expect(truncateUtf16(exact, TASK_STATUS_TEXT_LIMIT, TASK_STATUS_TRUNCATION_MARKER)).toBe(exact)
  })
})

describe('aggregate child spend ceiling', () => {
  // One step: optional tool call, plus finish usage in the units recordSpend charges.
  const spendStep = (tokens: number, call?: string) =>
    streamOf([
      ...(call
        ? [
            { type: 'tool-input-start', toolCallId: `k${Math.random()}`, toolName: call },
            { type: 'tool-input-available', toolCallId: `k${Math.random()}`, toolName: call, input: {} },
          ]
        : [{ type: 'text-delta', id: 't', delta: 'ok' }]),
      { type: 'finish', messageMetadata: { usage: { inputTokens: 0, outputTokens: tokens, totalTokens: tokens } } },
    ])
  const outputs = (threadId: string) =>
    takeTaskStatus(threadId).filter((r) => r.status === 'error' || r.status === 'done')

  it('keeps the old constant as an alias of the renamed spend cap, and the aggregate is finite and larger', () => {
    expect(CHAT_CHILD_MAX_COMPLETION_TOKENS).toBe(CHAT_CHILD_MAX_SPEND_TOKENS)
    expect(CHAT_CHILD_AGGREGATE_SPEND_TOKENS).toBeGreaterThan(CHAT_CHILD_MAX_SPEND_TOKENS)
    expect(CHAT_CHILD_AGGREGATE_SPEND_TOKENS).toBeLessThan(6 * CHAT_CHILD_MAX_SPEND_TOKENS)
  })

  it('two children share one ceiling: the sibling is stopped by the aggregate, not its own cap', async () => {
    const { ctx } = ctxFor()
    let calls = 0
    hoisted.childStep.mockImplementation(async (o: { messages: Array<{ parts: Array<{ text?: string }> }> }) => {
      calls++
      const task = o.messages[0].parts[0].text
      // 'big' overshoots its own cap in one step (no hard per-request cap exists).
      if (task === 'big') return spendStep(CHAT_CHILD_AGGREGATE_SPEND_TOKENS - 5_000)
      return spendStep(4_000, 'read')
    })
    await runChatTask({ subagents: [{ name: 'big', task: 'big' }, { name: 'small', task: 'small' }] }, 'call', ctx)
    await settle(120)
    const rows = outputs(ctx.threadId)
    const small = rows.find((r) => r.name === 'small')
    expect(small?.status).toBe('error')
    expect(small?.error).toContain("shared token budget")
    // Bounded: far fewer steps than the 12-step child limit would allow for `small`.
    expect(calls).toBeLessThanOrEqual(1 + 4)
  })

  it('no new task spend after the cap: a later task call in the same run is refused and starts nothing', async () => {
    const { ctx } = ctxFor()
    hoisted.childStep.mockImplementation(async () => spendStep(CHAT_CHILD_AGGREGATE_SPEND_TOKENS + 1))
    await runChatTask({ subagents: [{ name: 'a', task: 'x' }, { name: 'b', task: 'y' }] }, 'c1', ctx)
    await settle(120)
    const before = hoisted.childStep.mock.calls.length
    const again = await runChatTask(oneChild(), 'c2', ctx)
    expect(again.isError).toBe(true)
    expect(again.output).toContain('shared token budget')
    await settle(40)
    expect(hoisted.childStep.mock.calls.length).toBe(before)
  })

  it('a queued child that gets its slot after the aggregate is spent never starts', async () => {
    const { ctx } = ctxFor()
    hoisted.childStep.mockImplementation(async () => spendStep(CHAT_CHILD_AGGREGATE_SPEND_TOKENS))
    const subagents = Array.from({ length: CHAT_MAX_CONCURRENT_CHILDREN + 1 }, (_, i) => ({ name: `c${i}`, task: 'x' }))
    await runChatTask({ subagents }, 'c1', ctx)
    await settle(120)
    // Only the children that held a slot at once ever sent a step.
    expect(hoisted.childStep.mock.calls.length).toBe(CHAT_MAX_CONCURRENT_CHILDREN)
  })

  it('Stop is bounded and leaves another thread\'s run untouched', async () => {
    const a = ctxFor()
    const b = ctxFor()
    hang()
    await runChatTask(oneChild(), 'a', a.ctx)
    await settle()
    a.controller.abort()
    await settle(40)
    const aRows = takeTaskStatus(a.ctx.threadId)
    const latest = new Map(aRows.map((row) => [row.runId, row]))
    expect(latest.size).toBeGreaterThan(0)
    expect([...latest.values()].every((row) => row.status === 'error')).toBe(true)
    // Another thread's run still has its own full, unspent ledger.
    hoisted.childStep.mockReset()
    hoisted.childStep.mockImplementation(async () => spendStep(1_000))
    const out = await runChatTask(oneChild(), 'b', b.ctx)
    expect(out.isError).toBeUndefined()
    await settle(60)
    expect(outputs(b.ctx.threadId).map((r) => r.status)).toEqual(['done'])
  })
})

describe('terminal flush ordering through the real run stream', () => {
  const taskCall = () =>
    streamOf([
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 'tk', toolName: 'task', input: {} },
      { type: 'finish-step' },
      { type: 'finish' },
    ])
  const user = { id: 'u', role: 'user' as const, parts: [{ type: 'text' as const, text: 'go' }] }
  async function run(opts: {
    sendSecond: () => Promise<ReadableStream<UIMessageChunk>>
    maxSteps?: number
    abortAfterDispatch?: boolean
  }) {
    const { ctx, controller } = ctxFor()
    const outer = new AbortController()
    hang()
    let step = 0
    const sendStep = vi.fn(async () => (++step === 1 ? taskCall() : opts.sendSecond()))
    const order: string[] = []
    const stream = createChatRunStream({
      messages: [user],
      messageId: 'a',
      signal: outer.signal,
      maxSteps: opts.maxSteps,
      sendStep,
      inbox: chatRunInbox(ctx.threadId),
      dispatch: async (_call, signal) => {
        const out = await runChatTask(oneChild(), 'tk', { ...ctx, signal })
        await settle(5)
        if (opts.abortAfterDispatch) outer.abort('fixture Stop')
        return out
      },
      onFinally: () => {
        order.push('finally')
        settleChatRun(ctx.threadId)
      },
    })
    let message
    for await (const m of readUIMessageStream({ stream })) message = m
    controller.abort()
    return { message: message!, order, ctx }
  }
  const finalStatuses = (m: Parameters<typeof taskStatusRows>[0][number]) =>
    taskStatusRows([m]).map((r) => r.status)

  it('error terminal: the persisted row is error, never running', async () => {
    const { message } = await run({ sendSecond: async () => { throw new Error('provider failed') } })
    expect(finalStatuses(message)).toEqual(['error'])
  })

  it('budget cap terminal: stopped turn persists the child as error', async () => {
    const { message } = await run({ maxSteps: 1, sendSecond: async () => streamOf([]) })
    expect(message.metadata).toMatchObject({ stopped: true, runStopReason: 'steps' })
    expect(finalStatuses(message)).toEqual(['error'])
  })

  it('abort terminal: Stop mid-child persists the child as error', async () => {
    const { message } = await run({ abortAfterDispatch: true, sendSecond: async () => streamOf([]) })
    expect(finalStatuses(message)).toEqual(['error'])
  })

  it('onFinally settle after finish finds nothing left to flush (no missed terminal row)', async () => {
    const { ctx } = await run({ sendSecond: async () => { throw new Error('boom') } })
    expect(takeTaskStatus(ctx.threadId)).toEqual([])
  })
})
