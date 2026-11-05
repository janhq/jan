import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolApprovalRequests } from '../useToolApprovalRequests'
import { useToolApproval } from '../useToolApproval'
import { toolWireName } from '@/lib/extensions/tools'

// Real wire names, so a name shape can never pass for the origin flag.
const X = toolWireName('acme.one', 'x_tool')
const Y = toolWireName('acme.one', 'y_tool')
const EXT = { origin: 'extension' } as const

// useToolApproval persists via backendStorage; stub the persist layer so the
// import is inert and no disk I/O happens in tests.
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: { toolApproval: 'tool-approval-settings' },
}))
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

describe('useToolApprovalRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToolApprovalRequests.setState({ pending: {} })
    useToolApproval.setState({
      approvedTools: {},
      approvedServers: [],
      approvedToolsGlobal: [],
      allowAllMCPPermissions: false,
    })
  })

  it('stores a pending approval keyed by toolCallId', () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    act(() => {
      result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })

    expect(result.current.pending['tc1']).toMatchObject({
      toolCallId: 'tc1',
      toolName: 'tool-a',
      threadId: 'thread-1',
    })
  })

  it('auto-resolves true (no pending) when allowAllMCPPermissions is set', async () => {
    useToolApproval.setState({ allowAllMCPPermissions: true })
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })

    await expect(p!).resolves.toBe(true)
    expect(result.current.pending['tc1']).toBeUndefined()
  })

  // janhq/jan-internal#517: a call the model an extension serves made to a
  // built-in tool. Neither the MCP shortcut nor a grant saved on an ordinary
  // turn may answer it: the user has to see that this model wants the tool.
  it('asks for a strict request whatever the shortcuts and saved grants say', async () => {
    useToolApproval.setState({ allowAllMCPPermissions: true })
    act(() => {
      useToolApproval.getState().approveToolForThread('thread-1', 'web_fetch')
      useToolApproval.getState().approveToolEverywhere('web_fetch')
    })
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'web_fetch', 'thread-1', undefined, {
        strict: true,
      })
    })
    expect(result.current.pending['tc1']).toBeDefined()
    // Only this call: a strict approval is never saved as a grant.
    act(() => result.current.resolveApproval('tc1', 'allow-always'))
    await expect(p!).resolves.toBe(true)
    act(() => {
      result.current.requestApproval('tc2', 'web_fetch', 'thread-1', undefined, {
        strict: true,
      })
    })
    expect(result.current.pending['tc2']).toBeDefined()
  })

  it('auto-resolves true (no pending) when the tool is already approved for the thread', async () => {
    act(() => {
      useToolApproval.getState().approveToolForThread('thread-1', 'tool-a')
    })
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })

    await expect(p!).resolves.toBe(true)
    expect(result.current.pending['tc1']).toBeUndefined()
  })

  it('resolveApproval allow-once resolves true without persisting the tool', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-once')
    })

    await expect(p!).resolves.toBe(true)
    expect(useToolApproval.getState().isToolApproved('thread-1', 'tool-a')).toBe(false)
    expect(result.current.pending['tc1']).toBeUndefined()
  })

  it('resolveApproval allow-thread persists the tool for that thread only', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-thread')
    })

    await expect(p!).resolves.toBe(true)
    const approval = useToolApproval.getState()
    expect(approval.isToolApproved('thread-1', 'tool-a')).toBe(true)
    expect(approval.isToolApproved('thread-2', 'tool-a')).toBe(false)
  })

  // "Always" has to mean always, which is what the thread scope could not say.
  it('resolveApproval allow-always trusts the whole server, in every thread', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1', 'github')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-always')
    })

    await expect(p!).resolves.toBe(true)
    const approval = useToolApproval.getState()
    expect(approval.isToolApproved('thread-2', 'other-tool', 'github')).toBe(
      true
    )
    expect(approval.isToolApproved('thread-2', 'tool-a', 'gitlab')).toBe(false)
  })

  it('resolveApproval allow-always falls back to the tool when it has no server', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-always')
    })

    await expect(p!).resolves.toBe(true)
    const approval = useToolApproval.getState()
    expect(approval.isToolApproved('thread-2', 'tool-a')).toBe(true)
    expect(approval.isToolApproved('thread-2', 'tool-b')).toBe(false)
  })

  it('auto-resolves true when the tool comes from an already trusted server', async () => {
    act(() => {
      useToolApproval.getState().approveServer('github')
    })
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1', 'github')
    })

    await expect(p!).resolves.toBe(true)
    expect(result.current.pending['tc1']).toBeUndefined()
  })

  it('keeps the server on the pending entry so the prompt can name it', () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    act(() => {
      result.current.requestApproval('tc1', 'tool-a', 'thread-1', 'github')
    })

    expect(result.current.pending['tc1']).toMatchObject({
      serverName: 'github',
    })
  })

  it('resolveApproval deny resolves false', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'deny')
    })

    await expect(p!).resolves.toBe(false)
    expect(useToolApproval.getState().isToolApproved('thread-1', 'tool-a')).toBe(false)
  })

  it('clearPendingForThread resolves matching promises false and removes only that thread', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let pA: Promise<boolean>
    let pB: Promise<boolean>
    act(() => {
      pA = result.current.requestApproval('tcA', 'tool-a', 'thread-A')
      pB = result.current.requestApproval('tcB', 'tool-b', 'thread-B')
    })

    act(() => {
      result.current.clearPendingForThread('thread-A')
    })

    await expect(pA!).resolves.toBe(false)
    expect(result.current.pending['tcA']).toBeUndefined()
    expect(result.current.pending['tcB']).toMatchObject({ threadId: 'thread-B' })

    act(() => {
      result.current.resolveApproval('tcB', 'allow-once')
    })
    await expect(pB!).resolves.toBe(true)
  })

  it('clearPendingForThread is a no-op when nothing matches', () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    act(() => {
      result.current.requestApproval('tcA', 'tool-a', 'thread-A')
    })
    act(() => {
      result.current.clearPendingForThread('thread-Z')
    })

    expect(result.current.pending['tcA']).toMatchObject({ threadId: 'thread-A' })
  })

  it('does not auto-approve extension tools when allowAllMCPPermissions is set', () => {
    useToolApproval.setState({ allowAllMCPPermissions: true })
    const { result } = renderHook(() => useToolApprovalRequests())
    act(() => {
      result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', EXT)
    })
    expect(result.current.pending['tc1']).toBeDefined()
  })

  it('keeps an allow-thread approval with the extension that got it', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', EXT)
    })
    act(() => result.current.resolveApproval('tc1', 'allow-thread'))
    await expect(p!).resolves.toBe(true)
    // The same tool name from another extension, or from an MCP server, asks.
    act(() => {
      result.current.requestApproval('tc2', X, 'thread-1', 'ext:acme.two', EXT)
      result.current.requestApproval('tc3', X, 'thread-1', 'mcp-server')
      result.current.requestApproval('tc4', X, 'thread-1')
    })
    expect(Object.keys(result.current.pending).sort()).toEqual(['tc2', 'tc3', 'tc4'])
    // The extension that was approved is not asked again.
    let again: Promise<boolean>
    act(() => {
      again = result.current.requestApproval('tc5', X, 'thread-1', 'ext:acme.one', EXT)
    })
    await expect(again!).resolves.toBe(true)
  })

  it('keeps an extension approval away from an MCP tool spelling its key', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', EXT)
    })
    act(() => result.current.resolveApproval('tc1', 'allow-thread'))
    await expect(p!).resolves.toBe(true)
    // An MCP tool whose literal name is the extension tool's approval key.
    act(() => {
      result.current.requestApproval('tc2', `ext:acme.one/${X}`, 'thread-1', 'mcp-server')
    })
    expect(Object.keys(result.current.pending)).toEqual(['tc2'])
  })

  // The user names MCP servers; one called `ext:<id>` must stay an MCP server.
  it('treats an MCP server named like an extension as MCP', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', EXT)
    })
    act(() => result.current.resolveApproval('tc1', 'allow-thread'))
    await expect(p!).resolves.toBe(true)
    act(() => {
      result.current.requestApproval('tc2', 'x_tool', 'thread-1', 'ext:acme.one')
    })
    expect(Object.keys(result.current.pending)).toEqual(['tc2'])
    act(() => result.current.resolveApproval('tc2', 'allow-always'))
    // No server-wide trust for an ext: name: it would cover the real
    // extension's tools. The grant is for this one MCP tool.
    expect(useToolApproval.getState().approvedServers).toEqual([])
    expect(useToolApproval.getState().approvedToolsGlobal).toEqual([
      'mcp:ext:acme.one/x_tool',
    ])
    act(() => {
      result.current.requestApproval('tc3', X, 'thread-2', 'ext:acme.one', EXT)
      result.current.requestApproval('tc4', Y, 'thread-2', 'ext:acme.one', EXT)
    })
    expect(Object.keys(result.current.pending)).toEqual(['tc3', 'tc4'])
  })

  // Name shape is no proof of origin: an MCP server the user called
  // `ext:acme.one` can expose a tool with the extension's exact wire name.
  describe('an MCP tool spelling an extension tool exactly', () => {
    const MCP = { origin: 'mcp' } as const

    it.each(['allow-thread', 'allow-always'] as const)(
      'does not share the extension tool %s grant',
      async (decision) => {
        const { result } = renderHook(() => useToolApprovalRequests())
        let p: Promise<boolean>
        act(() => {
          p = result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', EXT)
        })
        act(() => result.current.resolveApproval('tc1', decision))
        await expect(p!).resolves.toBe(true)
        act(() => {
          result.current.requestApproval('tc2', X, 'thread-1', 'ext:acme.one', MCP)
          result.current.requestApproval('tc3', X, 'thread-1', 'ext:acme.one')
        })
        expect(Object.keys(result.current.pending).sort()).toEqual(['tc2', 'tc3'])
      }
    )

    it.each(['allow-thread', 'allow-always'] as const)(
      'does not hand its %s grant to the extension tool',
      async (decision) => {
        const { result } = renderHook(() => useToolApprovalRequests())
        let p: Promise<boolean>
        act(() => {
          p = result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', MCP)
        })
        act(() => result.current.resolveApproval('tc1', decision))
        await expect(p!).resolves.toBe(true)
        expect(useToolApproval.getState().approvedServers).toEqual([])
        act(() => {
          result.current.requestApproval('tc2', X, 'thread-1', 'ext:acme.one', EXT)
        })
        expect(Object.keys(result.current.pending)).toEqual(['tc2'])
      }
    )
  })

  // A build that saved server trust for an ext: name must not keep it working.
  it('ignores a saved server trust for an ext: name', () => {
    useToolApproval.setState({ approvedServers: ['ext:acme.one'] })
    const { result } = renderHook(() => useToolApprovalRequests())
    act(() => {
      result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', EXT)
    })
    expect(Object.keys(result.current.pending)).toEqual(['tc1'])
  })

  it('keeps an MCP allow-thread approval with the server that got it', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'x_tool', 'thread-1', 'server-a')
    })
    act(() => result.current.resolveApproval('tc1', 'allow-thread'))
    await expect(p!).resolves.toBe(true)
    act(() => {
      result.current.requestApproval('tc2', 'x_tool', 'thread-1', 'server-b')
    })
    expect(Object.keys(result.current.pending)).toEqual(['tc2'])
    let again: Promise<boolean>
    act(() => {
      again = result.current.requestApproval('tc3', 'x_tool', 'thread-1', 'server-a')
    })
    await expect(again!).resolves.toBe(true)
  })

  it('keeps an allow-always approval to the one extension tool that got it', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', X, 'thread-1', 'ext:acme.one', EXT)
    })
    act(() => result.current.resolveApproval('tc1', 'allow-always'))
    await expect(p!).resolves.toBe(true)
    expect(useToolApproval.getState().approvedServers).toEqual([])
    // Another tool of the same extension (one an update added, say) asks.
    act(() => {
      result.current.requestApproval('tc2', Y, 'thread-1', 'ext:acme.one', EXT)
    })
    expect(Object.keys(result.current.pending)).toEqual(['tc2'])
    // The approved tool runs without asking, in any thread.
    let again: Promise<boolean>
    act(() => {
      again = result.current.requestApproval('tc3', X, 'thread-2', 'ext:acme.one', EXT)
    })
    await expect(again!).resolves.toBe(true)
  })
})
