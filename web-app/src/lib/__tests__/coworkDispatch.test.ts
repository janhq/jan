import { describe, it, expect, vi, beforeEach } from 'vitest'

const { executeAgentTool } = vi.hoisted(() => ({ executeAgentTool: vi.fn() }))
vi.mock('@/lib/agentTools', () => ({ executeAgentTool }))

const { executeWebTool } = vi.hoisted(() => ({ executeWebTool: vi.fn() }))
vi.mock('@/lib/webSearchTool', () => ({
  WEB_TOOL_NAMES: new Set(['web_search', 'web_fetch']),
  executeWebTool,
}))

const coworkConfig = vi.hoisted(() => ({ networkEnabled: true }))
vi.mock('@/hooks/useCoworkConfig', () => ({
  useCoworkConfig: { getState: () => coworkConfig },
}))

import { dispatchCoworkTool } from '../coworkDispatch'
import type { PendingToolCall } from '../coworkRunner'

const call = (toolName: string, input: unknown = {}): PendingToolCall => ({
  toolCallId: 'c1',
  toolName,
  input,
})

const ctx = (over = {}) => ({
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
      true
    )
  })

  // Cowork's shell network follows the Cowork setting (on by default), read
  // per call so a Settings toggle applies to the next command.
  it('passes the cowork network setting through per call', async () => {
    await dispatchCoworkTool(call('bash', { command: 'curl x' }), ctx())
    expect(executeAgentTool).toHaveBeenCalledWith(
      'bash',
      { command: 'curl x' },
      's1',
      null,
      'session',
      true
    )
    coworkConfig.networkEnabled = false
    try {
      await dispatchCoworkTool(call('bash', { command: 'curl x' }), ctx())
      expect(executeAgentTool).toHaveBeenLastCalledWith(
        'bash',
        { command: 'curl x' },
        's1',
        null,
        'session',
        false
      )
    } finally {
      coworkConfig.networkEnabled = true
    }
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

  it('passes the attached folder through', async () => {
    await dispatchCoworkTool(call('grep'), ctx({ readOnlyFolder: '/repo' }))
    expect(executeAgentTool).toHaveBeenCalledWith(
      'grep',
      {},
      's1',
      '/repo',
      'session',
      true
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

  it('reports a plugin failure as a tool error', async () => {
    executeWebTool.mockResolvedValue({ error: 'no API key' })
    const out = await dispatchCoworkTool(
      call('web_fetch', { url: 'https://x.dev' }),
      ctx({ webSearch: true })
    )
    expect(out).toMatchObject({ output: 'no API key', isError: true })
  })
})
