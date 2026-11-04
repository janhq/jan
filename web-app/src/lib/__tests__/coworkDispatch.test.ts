import { describe, it, expect, vi, beforeEach } from 'vitest'

const native = vi.hoisted(() => ({
  executeAgentTool: vi.fn(),
  startAgentMonitor: vi.fn(),
  stopAgentMonitor: vi.fn(),
  listAgentMonitors: vi.fn(),
}))
const { executeAgentTool } = native
vi.mock('@/lib/agentTools', () => native)

const { executeWebTool } = vi.hoisted(() => ({ executeWebTool: vi.fn() }))
vi.mock('@/lib/webSearchTool', () => ({
  WEB_TOOL_NAMES: new Set(['web_search', 'web_fetch']),
  executeWebTool,
}))

const chatPermissions = vi.hoisted(() => ({ shellNetwork: true }))
vi.mock('@/hooks/useChatPermissions', () => ({
  useChatPermissions: { getState: () => chatPermissions },
}))

import type { Tool } from 'ai'
import { dispatchCoworkTool } from '../coworkDispatch'
import type { PendingToolCall } from '../coworkRunner'

const call = (toolName: string, input: unknown = {}): PendingToolCall => ({
  toolCallId: 'c1',
  toolName,
  input,
})

const ctx = (over = {}) => ({
  advertisedTools: Object.fromEntries([
    'read', 'ls', 'find', 'grep', 'write', 'edit', 'shell', 'screenshot',
    'memory', 'skill_list', 'skill_read', 'skill_write', 'todo', 'ask', 'task',
    'monitor', 'web_search', 'web_fetch',
  ].map((name) => [name, {} as Tool])),
  monitors: null,
  sessionId: 's1',
  readOnlyFolder: null,
  planMode: false,
  webSearch: false,
  onTodo: vi.fn(async () => ({ output: 'todo ok' })),
  onAsk: vi.fn(async () => ({ output: 'ask ok' })),
  onTask: vi.fn(async () => ({ output: 'task ok' })),
  ...over,
})

describe('dispatchCoworkTool', () => {
  beforeEach(() => {
    executeAgentTool.mockReset()
    executeAgentTool.mockResolvedValue({ content: 'ok' })
  })

  it.each([
    'unknown_tool', 'bash', 'toString', 'constructor', '__proto__',
    'shell', 'write', 'memory', 'skill_write', 'task', 'ask', 'todo',
    'monitor', 'web_search', 'web_fetch',
  ])('refuses unknown or withheld %s before any side effect', async (name) => {
    vi.clearAllMocks()
    const c = ctx({ advertisedTools: { read: {} as Tool }, webSearch: true })
    const out = await dispatchCoworkTool(call(name, { op: 'start' }), c)
    expect(out).toMatchObject({ isError: true })
    expect(out.output).toContain('not available to this run')
    for (const fn of Object.values(native)) expect(fn).not.toHaveBeenCalled()
    expect(executeWebTool).not.toHaveBeenCalled()
    expect(c.onTodo).not.toHaveBeenCalled()
    expect(c.onAsk).not.toHaveBeenCalled()
    expect(c.onTask).not.toHaveBeenCalled()
  })

  it('fails closed with an empty advertised record', async () => {
    const out = await dispatchCoworkTool(call('read'), ctx({ advertisedTools: {} }))
    expect(out.isError).toBe(true)
    expect(executeAgentTool).not.toHaveBeenCalled()
  })

  describe('against a plan-mode record', () => {
    const planRecord = Object.fromEntries([
      'read', 'ls', 'find', 'grep', 'screenshot', 'memory', 'skill_list',
      'skill_read', 'todo', 'ask', 'web_search', 'web_fetch',
    ].map((name) => [name, {} as Tool]))
    const planCtx = () =>
      ctx({ planMode: true, advertisedTools: planRecord, webSearch: true })

    it.each(['write', 'edit', 'shell', 'skill_write', 'task', 'monitor'])(
      'keeps the plan-mode guidance for withheld %s',
      async (name) => {
        const out = await dispatchCoworkTool(call(name), planCtx())
        expect(out.isError).toBe(true)
        expect(out.output).toMatch(/disabled in plan mode/)
        expect(executeAgentTool).not.toHaveBeenCalled()
      }
    )

    it('refuses an unknown tool before the native registry', async () => {
      const out = await dispatchCoworkTool(call('bash'), planCtx())
      expect(out.output).toContain('not available to this run')
      expect(executeAgentTool).not.toHaveBeenCalled()
    })

    it.each(['read', 'skill_read'])('dispatches advertised %s', async (name) => {
      const out = await dispatchCoworkTool(call(name), planCtx())
      expect(out.isError).toBeFalsy()
      expect(executeAgentTool).toHaveBeenCalledOnce()
    })

    it('dispatches memory view but refuses a memory write', async () => {
      const c = planCtx()
      const view = await dispatchCoworkTool(call('memory', { op: 'view' }), c)
      expect(view.isError).toBeFalsy()
      const write = await dispatchCoworkTool(call('memory', { op: 'write' }), c)
      expect(write.isError).toBe(true)
      expect(executeAgentTool).toHaveBeenCalledOnce()
    })

    it('passes a Plan callback that returns true while the run is in Plan', async () => {
      await dispatchCoworkTool(call('read', { path: 'a' }), planCtx())
      const planActive = executeAgentTool.mock.calls[0][10]
      expect(planActive).toEqual(expect.any(Function))
      expect(planActive()).toBe(true)
    })

    it('runs todo and ask through their callbacks', async () => {
      const c = planCtx()
      await dispatchCoworkTool(call('todo'), c)
      await dispatchCoworkTool(call('ask'), c)
      expect(c.onTodo).toHaveBeenCalledOnce()
      expect(c.onAsk).toHaveBeenCalledOnce()
    })
  })

  it.each(['skill_list', 'skill_read'])('dispatches advertised %s', async (name) => {
    const out = await dispatchCoworkTool(call(name), ctx())
    expect(out.isError).toBeFalsy()
    expect(executeAgentTool).toHaveBeenCalledWith(name, {}, 's1', null, 'session', true, true, null, undefined, undefined, expect.any(Function))
  })

  describe('Plan callback handed to executeAgentTool', () => {
    const planActiveOf = () => executeAgentTool.mock.calls[0][10] as () => boolean

    it('returns false for a normal (non-Plan) run', async () => {
      await dispatchCoworkTool(call('read', { path: 'a' }), ctx({ planMode: false }))
      expect(planActiveOf()()).toBe(false)
    })

    it('returns true for a Plan run', async () => {
      await dispatchCoworkTool(call('read', { path: 'a' }), ctx({ planMode: true }))
      expect(planActiveOf()()).toBe(true)
    })

    it('follows the latched state on Execute/Exit transitions, not a snapshot', async () => {
      const c = ctx({ planMode: true })
      await dispatchCoworkTool(call('read', { path: 'a' }), c)
      const planActive = planActiveOf()
      expect(planActive()).toBe(true)
      c.planMode = false // reviewed Execute/Exit clears the latch
      expect(planActive()).toBe(false)
      c.planMode = true // and a later Plan entry latches again
      expect(planActive()).toBe(true)
    })
  })

  // The trailing 'session' is load-bearing: under the default 'thread' scope a
  // session's files land where the thread sweep's keep-list can never mention
  // them, and the sweep deletes the only copy of the agent's work.
  it('routes built-ins to the Rust plugin with the session as workspace key', async () => {
    const c = ctx()
    await dispatchCoworkTool(call('read', { path: 'a' }), c)
    expect(executeAgentTool).toHaveBeenCalledWith(
      'read',
      { path: 'a' },
      's1',
      null,
      'session',
      true,
      true,
      null,
      undefined,
      undefined,
      expect.any(Function)
    )
  })

  // Shell network follows the app-wide permission (on by default), read
  // per call so a Settings toggle applies to the next command.
  it('passes the app-wide network setting through per call', async () => {
    await dispatchCoworkTool(call('shell', { command: 'curl x' }), ctx())
    expect(executeAgentTool).toHaveBeenCalledWith(
      'shell',
      { command: 'curl x' },
      's1',
      null,
      'session',
      true,
      true,
      null,
      undefined,
      undefined,
      expect.any(Function)
    )
    chatPermissions.shellNetwork = false
    try {
      await dispatchCoworkTool(call('shell', { command: 'curl x' }), ctx())
      expect(executeAgentTool).toHaveBeenLastCalledWith(
        'shell',
        { command: 'curl x' },
        's1',
        null,
        'session',
        false,
        true,
        null,
        undefined,
        undefined,
        expect.any(Function)
      )
    } finally {
      chatPermissions.shellNetwork = true
    }
  })

  it('passes the owning run signal through for late-result feedback suppression', async () => {
    const signal = new AbortController().signal
    await dispatchCoworkTool(call('memory', { op: 'write' }), ctx({ signal }))
    expect(executeAgentTool.mock.calls[0][9]).toBe(signal)
  })

  it('routes the client-only tools to their handlers', async () => {
    const c = ctx()
    expect((await dispatchCoworkTool(call('todo'), c)).output).toBe('todo ok')
    expect((await dispatchCoworkTool(call('ask'), c)).output).toBe('ask ok')
    expect((await dispatchCoworkTool(call('task'), c)).output).toBe('task ok')
    expect(executeAgentTool).not.toHaveBeenCalled()
  })

  // Withholding a tool from the advertised set is not authoritative: a model
  // can still emit a call for one. Without this the run would happily write
  // files in a mode whose entire promise is that it does not.
  it('refuses a mutating tool in plan mode even though it was never advertised', async () => {
    const c = ctx({ planMode: true })
    const out = await dispatchCoworkTool(call('write', { path: 'a' }), c)
    expect(out.isError).toBe(true)
    expect(out.output).toMatch(/disabled in plan mode/)
    expect(executeAgentTool).not.toHaveBeenCalled()
  })

  it('still allows reads in plan mode', async () => {
    await dispatchCoworkTool(call('read'), ctx({ planMode: true }))
    expect(executeAgentTool).toHaveBeenCalled()
  })

  // Plan mode is read-only for memory too: the tool stays advertised for its
  // reads, so the refusal is per op.
  it('refuses memory ops that change the store in plan mode', async () => {
    for (const op of ['write', 'edit', 'delete', 'move']) {
      const out = await dispatchCoworkTool(
        call('memory', { op, name: 'n' }),
        ctx({ planMode: true })
      )
      expect(out.isError).toBe(true)
      expect(out.output).toMatch(/plan mode/)
      expect(out.output).toMatch(/view/)
    }
    expect(executeAgentTool).not.toHaveBeenCalled()
  })

  it('still runs memory view and search in plan mode', async () => {
    for (const op of ['view', 'search']) {
      await dispatchCoworkTool(
        call('memory', { op, query: 'q' }),
        ctx({ planMode: true })
      )
    }
    expect(executeAgentTool).toHaveBeenCalledTimes(2)
  })

  it('runs memory writes outside plan mode', async () => {
    await dispatchCoworkTool(call('memory', { op: 'write' }), ctx())
    expect(executeAgentTool).toHaveBeenCalled()
  })

  // The attached folder is passed twice: as the read-only filesystem root and
  // as the skill-overlay project (last arg), so the folder's skills reach the
  // agent on top of the permanent store (#8879).
  it('passes the attached folder through as both read root and skill overlay', async () => {
    await dispatchCoworkTool(call('grep'), ctx({ readOnlyFolder: '/repo' }))
    expect(executeAgentTool).toHaveBeenCalledWith(
      'grep',
      {},
      's1',
      '/repo',
      'session',
      true,
      true,
      '/repo',
      undefined,
      undefined,
      expect.any(Function)
    )
  })

  it('carries the display diff without putting it in the output', async () => {
    executeAgentTool.mockResolvedValue({
      content: 'Wrote a.txt',
      diff: '- a\n+ b',
    })
    const out = await dispatchCoworkTool(call('edit'), ctx())
    expect(out.output).toBe('Wrote a.txt')
    expect(out.diff).toBe('- a\n+ b')
  })

  it('carries returned images beside the output', async () => {
    const images = [{ dataUrl: 'data:image/png;base64,AA', name: 'a.html' }]
    executeAgentTool.mockResolvedValue({
      content: 'Screenshot of a.html (1280x960)',
      images,
    })
    const out = await dispatchCoworkTool(call('screenshot'), ctx())
    expect(out.output).toBe('Screenshot of a.html (1280x960)')
    expect(out.images).toEqual(images)
  })

  // A rejection would abort the whole run; the model can usually recover if it
  // is simply told what failed.
  it('turns a tool error into a result instead of throwing', async () => {
    executeAgentTool.mockResolvedValue({ error: 'no such file' })
    const out = await dispatchCoworkTool(call('read'), ctx())
    expect(out).toEqual({ output: 'no such file', isError: true })
  })

  it('turns a thrown exception into a result too', async () => {
    executeAgentTool.mockRejectedValue(new Error('ipc died'))
    const out = await dispatchCoworkTool(call('read'), ctx())
    expect(out).toEqual({ output: 'ipc died', isError: true })
  })
})

it('pauses repeated failed reads for review without swallowing the read error', async () => {
  const error = 'ERROR: No such file or directory (os error 2)'
  executeAgentTool.mockResolvedValue({ error })
  let review: unknown
  let answer!: (result: { output: string }) => void
  const context = ctx({
    planMode: true,
    failedReadPaths: new Set<string>(),
    onAsk: async (_id: string, input: unknown) => {
      review = input
      return new Promise<{ output: string }>((resolve) => {
        answer = resolve
      })
    },
  })
  const first = await dispatchCoworkTool(
    call('read', { path: 'index.html' }),
    context
  )
  expect(first.isError).toBe(true)
  expect(review).toBeUndefined()
  let finished = false
  const second = dispatchCoworkTool(
    call('read', { path: 'index.html' }),
    context
  ).then((result) => {
    finished = true
    return result
  })
  await vi.waitFor(() => expect(review).toBeDefined())
  expect(finished).toBe(false)
  answer({ output: 'Keep planning' })
  const result = await second
  expect(result.isError).toBe(true)
  expect(result.output).toContain(error)
  expect(result.output).toContain('Keep planning')
})

describe('web tools', () => {
  beforeEach(() => executeWebTool.mockReset())

  it('routes a web call to the websearch plugin', async () => {
    executeWebTool.mockResolvedValue({ content: { kind: 'web', results: [] } })
    const out = await dispatchCoworkTool(
      call('web_search', { query: 'jan' }),
      ctx({ webSearch: true })
    )
    expect(executeWebTool).toHaveBeenCalledWith('web_search', { query: 'jan' })
    // Serialized, not passed through: the model gets a string, and the citation
    // parser re-parses it for the source chips.
    expect(JSON.parse(out.output)).toMatchObject({ kind: 'web' })
    expect(out.isError).toBeFalsy()
  })

  // Withholding is not authoritative -- a model can call a tool that was never
  // advertised -- so an off switch in Settings is enforced here too.
  it('refuses without reaching the network when web search is off', async () => {
    const out = await dispatchCoworkTool(call('web_search'), ctx())
    expect(executeWebTool).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
    expect(out.output).toContain('Settings')
  })

  // The real off-state record withholds web tools; the reason still wins over
  // the generic membership refusal.
  it('names the setting when the off-state record withholds web tools', async () => {
    const out = await dispatchCoworkTool(
      call('web_fetch'),
      ctx({ advertisedTools: { read: {} as Tool } })
    )
    expect(executeWebTool).not.toHaveBeenCalled()
    expect(out.isError).toBe(true)
    expect(out.output).toContain('web access is disabled in Settings')
  })

  it('reports a plugin failure as a tool error', async () => {
    executeWebTool.mockResolvedValue({ error: 'no API key' })
    const out = await dispatchCoworkTool(
      call('web_fetch', { url: 'https://x.dev' }),
      ctx({ webSearch: true })
    )
    expect(out).toMatchObject({ output: 'no API key', isError: true })
  })
})

describe('shared client dispatch integration', () => {
  it.each(['onTodo', 'onAsk', 'onTask'] as const)('normalizes %s rejection once without falling through to native tools', async (handler) => {
    vi.clearAllMocks()
    const fn = vi.fn().mockRejectedValue(new Error('client failed'))
    const toolName = { onTodo: 'todo', onAsk: 'ask', onTask: 'task' }[handler]
    expect(await dispatchCoworkTool(call(toolName), ctx({ [handler]: fn }))).toEqual({ output: 'client failed', isError: true })
    expect(fn).toHaveBeenCalledOnce()
    expect(executeAgentTool).not.toHaveBeenCalled()
  })

  it('keeps monitor session/folder/network grants in the Cowork adapter', async () => {
    vi.clearAllMocks()
    native.startAgentMonitor.mockResolvedValue({ output: 'monitor-1' })
    const monitors = { update: vi.fn(), started: vi.fn(), stopped: vi.fn() }
    const input = { op: 'start', script: 'fixture', interval: 5 }
    await dispatchCoworkTool(call('monitor', input), ctx({ monitors, readOnlyFolder: '/synthetic-scope' }))
    expect(native.startAgentMonitor).toHaveBeenCalledExactlyOnceWith('s1', input, expect.any(Function), '/synthetic-scope', true, true)
    expect(monitors.started).toHaveBeenCalledOnce()
    expect(executeAgentTool).not.toHaveBeenCalled()
  })

  it('does not give a child a monitor lane', async () => {
    vi.clearAllMocks()
    expect(await dispatchCoworkTool(call('monitor', { op: 'start' }), ctx())).toEqual({ output: 'The monitor belongs to the agent that dispatched you.', isError: true })
    expect(native.startAgentMonitor).not.toHaveBeenCalled()
  })
})


it.each(['onTodo', 'onAsk', 'onTask'] as const)('fails closed when Cowork %s resolves undefined', async (handler) => {
  vi.clearAllMocks()
  const fn = vi.fn().mockResolvedValue(undefined)
  const toolName = { onTodo: 'todo', onAsk: 'ask', onTask: 'task' }[handler]
  expect(await dispatchCoworkTool(call(toolName), ctx({ [handler]: fn }))).toEqual({
    output: `The \`${toolName}\` client handler returned no outcome.`, isError: true,
  })
  expect(fn).toHaveBeenCalledOnce()
  for (const nativeFn of Object.values(native)) expect(nativeFn).not.toHaveBeenCalled()
  expect(executeWebTool).not.toHaveBeenCalled()
})
