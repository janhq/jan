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
  type ChildBinding,
  type ChatOrchestrationContext,
} from '../chatOrchestration'
import { dropConversationClientThread } from '../conversationClientTools'
import { defaultConversationCapabilities } from '../conversationCapabilities'
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
