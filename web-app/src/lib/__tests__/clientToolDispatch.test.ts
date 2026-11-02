import { describe, expect, it, vi } from 'vitest'
import { dispatchClientTool, type ClientToolHandlers, type ToolOutcome } from '../clientToolDispatch'
import { ASK_TOOL_NAME, TASK_TOOL_NAME, TODO_TOOL_NAME, CLIENT_TOOL_NAMES } from '../coworkTools'
import { MONITOR_TOOL_NAME } from '../coworkMonitor'

const handlers = (): ClientToolHandlers => ({
  onTodo: vi.fn(async () => ({ output: 'todo' })),
  onAsk: vi.fn(async () => ({ output: 'ask' })),
  onTask: vi.fn(async () => ({ output: 'task' })),
  onMonitor: vi.fn(async () => ({ output: 'monitor' })),
})

describe('dispatchClientTool', () => {
  it('routes exactly the builder client identities (guards literal-name drift without a production dependency cycle)', async () => {
    const identities = [TODO_TOOL_NAME, ASK_TOOL_NAME, TASK_TOOL_NAME, MONITOR_TOOL_NAME]
    expect(new Set(identities)).toEqual(CLIENT_TOOL_NAMES)
    const ctx = handlers()
    for (const toolName of identities) {
      expect(await dispatchClientTool({ toolName, toolCallId: 'identity', input: {} }, ctx)).toBeDefined()
    }
    for (const fn of Object.values(ctx)) expect(fn).toHaveBeenCalledOnce()
  })
  it.each(['todo', 'ask', 'task', 'monitor'])('awaits exactly one %s handler with unchanged input and outcome', async (toolName) => {
    const ctx = handlers()
    const input = { op: 'start', nested: ['unchanged'] }
    const outcome: ToolOutcome = {
      output: '', isError: false, diff: '-a\n+b',
      images: [{ dataUrl: 'data:image/png;base64,AA', name: 'fixture' }],
    }
    let settle!: (value: ToolOutcome) => void
    const handler = vi.fn(() => new Promise<ToolOutcome>((resolve) => { settle = resolve }))
    const key = { todo: 'onTodo', ask: 'onAsk', task: 'onTask', monitor: 'onMonitor' }[toolName] as keyof ClientToolHandlers
    ctx[key] = handler
    let done = false
    const pending = dispatchClientTool({ toolName, toolCallId: 'call-1', input }, ctx).then((value) => { done = true; return value })
    expect(handler).toHaveBeenCalledExactlyOnceWith(...(['ask', 'task'].includes(toolName) ? ['call-1', input] : [input]))
    await Promise.resolve()
    expect(done).toBe(false)
    settle(outcome)
    expect(await pending).toBe(outcome)
    for (const [name, fn] of Object.entries(ctx)) if (name !== key) expect(fn).not.toHaveBeenCalled()
  })

  it.each(['read', 'web_search', 'unknown', 'constructor', '__proto__', 'toString'])('leaves %s to the adapter without side effects', async (toolName) => {
    const ctx = handlers()
    expect(await dispatchClientTool({ toolName, toolCallId: 'c', input: null }, ctx)).toBeUndefined()
    for (const fn of Object.values(ctx)) expect(fn).not.toHaveBeenCalled()
  })

  it.each(['todo', 'ask', 'task', 'monitor'])('fails closed for an undefined %s outcome without reaching native fallback', async (toolName) => {
    const empty = vi.fn().mockResolvedValue(undefined)
    const ctx = { onTodo: empty, onAsk: empty, onTask: empty, onMonitor: empty }
    const nativeFallback = vi.fn()
    // Same normalization/fallback boundary as the consuming surface adapter.
    const dispatch = async () => {
      try {
        const outcome = await dispatchClientTool({ toolName, toolCallId: 'bad-handler', input: {} }, ctx)
        return outcome !== undefined ? outcome : nativeFallback()
      } catch (error) {
        return { output: (error as Error).message, isError: true }
      }
    }
    expect(await dispatch()).toEqual({ output: `The \`${toolName}\` client handler returned no outcome.`, isError: true })
    expect(empty).toHaveBeenCalledOnce()
    expect(nativeFallback).not.toHaveBeenCalled()
  })

  it('does not swallow or retry a handler failure', async () => {
    const ctx = handlers()
    const error = new Error('fixture failure')
    ctx.onAsk = vi.fn().mockRejectedValue(error)
    await expect(dispatchClientTool({ toolName: 'ask', toolCallId: 'c', input: {} }, ctx)).rejects.toBe(error)
    expect(ctx.onAsk).toHaveBeenCalledOnce()
  })
})
