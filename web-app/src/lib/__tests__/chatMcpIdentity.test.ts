import { describe, expect, it, vi } from 'vitest'
import type { MCPTool } from '@/types/completion'
import { assertMcpIdentityAvailable, uniqueMcpTools } from '../chatMcpIdentity'

const tool = (name: string, server: string): MCPTool => ({
  name, server, description: `${server}/${name}`, inputSchema: { type: 'object' },
})

describe('chat MCP identity', () => {
  it('preserves unique wire names and their original server binding', () => {
    const tools = [tool('read', 'alpha'), tool('write', 'beta')]
    expect(uniqueMcpTools(tools)).toEqual(tools)
    expect(uniqueMcpTools(tools)[0]).toBe(tools[0])
  })

  it('withholds every colliding name rather than choosing a server or renaming', () => {
    expect(uniqueMcpTools([
      tool('read', 'alpha'), tool('read', 'beta'), tool('write', 'alpha'),
    ])).toEqual([tool('write', 'alpha')])
    expect(uniqueMcpTools([tool('read', 'alpha'), tool('read', 'alpha')])).toEqual([])
  })

  it('withholds missing and blank identities, even when they rival a valid name', () => {
    expect(uniqueMcpTools([
      tool('missing', undefined as unknown as string), tool('blank', '  '),
      tool('read', 'alpha'), tool('read', ''),
    ])).toEqual([])
  })

  it('validates the advertised server/tool pair', async () => {
    const getTools = vi.fn().mockResolvedValue([tool('read', 'alpha')])
    const disabled = vi.fn().mockReturnValue(false)
    await expect(assertMcpIdentityAvailable('read', 'alpha', getTools, disabled)).resolves.toBeUndefined()
    expect(disabled).toHaveBeenCalledWith('alpha', 'read')
    expect(getTools).toHaveBeenCalledOnce()
  })

  it('rejects missing or disabled binding before requesting inventory', async () => {
    const getTools = vi.fn()
    await expect(assertMcpIdentityAvailable('read', undefined, getTools, () => false)).rejects.toThrow(/unavailable|disabled/)
    await expect(assertMcpIdentityAvailable('read', 'alpha', getTools, () => true)).rejects.toThrow(/unavailable|disabled/)
    expect(getTools).not.toHaveBeenCalled()
  })

  it.each([
    ['disconnected', []],
    ['moved to another server', [tool('read', 'beta')]],
    ['removed tool', [tool('write', 'alpha')]],
  ])('rejects a stale binding when %s', async (_reason, tools) => {
    await expect(assertMcpIdentityAvailable('read', 'alpha', async () => tools, () => false)).rejects.toThrow(/stale|ambiguous|unavailable/)
  })

  it('validates explicit alpha independently of a same-name beta rival', async () => {
    await expect(assertMcpIdentityAvailable('read', 'alpha', async () => [
      tool('read', 'alpha'), tool('read', 'beta'),
    ], (server) => server === 'beta')).resolves.toBeUndefined()
  })

  it('rechecks disabled state after asynchronous inventory validation', async () => {
    let disabled = false
    await expect(assertMcpIdentityAvailable('read', 'alpha', async () => {
      disabled = true
      return [tool('read', 'alpha')]
    }, () => disabled)).rejects.toThrow(/unavailable/)
  })

  it('fails closed when inventory cannot be fetched', async () => {
    await expect(assertMcpIdentityAvailable('read', 'alpha', async () => {
      throw new Error('disconnected')
    }, () => false)).rejects.toThrow('disconnected')
  })
  it('bounds fresh inventory validation without accepting a late result', async () => {
    vi.useFakeTimers()
    try {
      const validation = assertMcpIdentityAvailable('read', 'alpha', () => new Promise(() => {}), () => false)
      const rejected = expect(validation).rejects.toThrow(/validation timed out/)
      await vi.advanceTimersByTimeAsync(15_000)
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('Stop interrupts pending validation and clears its timer', async () => {
    vi.useFakeTimers()
    try {
      const stop = new AbortController()
      let late!: (tools: MCPTool[]) => void
      const validation = assertMcpIdentityAvailable('read', 'alpha', () => new Promise((resolve) => { late = resolve }), () => false, stop.signal)
      const rejected = expect(validation).rejects.toThrow(/Aborted/)
      await Promise.resolve()
      stop.abort()
      await rejected
      late([tool('read', 'alpha')])
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

})
