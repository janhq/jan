import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolApprovalRequests } from '../useToolApprovalRequests'
import { useToolApproval } from '../useToolApproval'
import { assertMcpIdentityAvailable } from '@/lib/chatMcpIdentity'
import type { MCPTool } from '@/types/completion'

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
    const requests = useToolApprovalRequests.getState()
    for (const entry of Object.values(requests.pending)) {
      requests.clearPendingForThread(entry.threadId)
    }
    useToolApprovalRequests.setState({ pending: {} })
    useToolApproval.setState({
      approvedTools: {},
      approvedMCPTools: [],
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

  it('allow-thread preserves the server identity for subsequent requests', async () => {
    const requests = useToolApprovalRequests.getState()
    const initial = requests.requestApproval('first', 'read_file', 'thread-1', 'server-a')
    requests.resolveApproval('first', 'allow-thread')
    await expect(initial).resolves.toBe(true)
    await expect(
      requests.requestApproval('same', 'read_file', 'thread-1', 'server-a')
    ).resolves.toBe(true)
    expect(useToolApprovalRequests.getState().pending).toEqual({})

    const other = requests.requestApproval('other', 'read_file', 'thread-1', 'server-b')
    expect(useToolApprovalRequests.getState().pending.other.serverName).toBe('server-b')
    requests.resolveApproval('other', 'deny')
    await expect(other).resolves.toBe(false)
    expect(useToolApproval.getState().approvedTools).toEqual({})
  })

  it('prompts for server tools despite legacy bare grants', async () => {
    useToolApproval.setState({
      approvedTools: { 'thread-1': ['read_file'] },
      approvedToolsGlobal: ['read_file'],
    })
    const requests = useToolApprovalRequests.getState()
    const pending = requests.requestApproval('legacy', 'read_file', 'thread-1', 'server-a')
    expect(useToolApprovalRequests.getState().pending.legacy).toBeDefined()
    requests.resolveApproval('legacy', 'deny')
    await expect(pending).resolves.toBe(false)
  })

  it('allowAll still bypasses approvals for server-qualified tools', async () => {
    useToolApproval.getState().setAllowAllMCPPermissions(true)
    await expect(
      useToolApprovalRequests.getState().requestApproval('all', 'read_file', 'thread-1', 'server-a')
    ).resolves.toBe(true)
    expect(useToolApprovalRequests.getState().pending).toEqual({})
    expect(useToolApproval.getState().approvedMCPTools).toEqual([])
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

  it.each([
    ['allow-thread', 'github'],
    ['allow-always', 'github'],
    ['allow-always', undefined],
  ] as const)(
    'cancelApproval denies without letting a stale %s decision persist trust (server: %s)',
    async (decision, serverName) => {
      const requests = useToolApprovalRequests.getState()
      const pending = requests.requestApproval('cancelled', 'tool-a', 'thread-1', serverName)
      // The UI can retain the action after the request has been cancelled.
      const staleResolve = requests.resolveApproval

      requests.cancelApproval('cancelled')
      await expect(pending).resolves.toBe(false)
      expect(useToolApprovalRequests.getState().pending.cancelled).toBeUndefined()
      staleResolve('cancelled', decision)

      const approval = useToolApproval.getState()
      expect(approval.approvedTools).toEqual({})
      expect(approval.approvedMCPTools).toEqual([])
      expect(approval.approvedServers).toEqual([])
      expect(approval.approvedToolsGlobal).toEqual([])
    }
  )

  it('cancelApproval leaves other calls pending, including calls in the same thread', async () => {
    const requests = useToolApprovalRequests.getState()
    const cancelled = requests.requestApproval('cancelled', 'tool-a', 'thread-1')
    const sameThread = requests.requestApproval('same-thread', 'tool-b', 'thread-1')
    const otherThread = requests.requestApproval('other-thread', 'tool-c', 'thread-2')
    const sameThreadSettled = vi.fn()
    const otherThreadSettled = vi.fn()
    void sameThread.then(sameThreadSettled)
    void otherThread.then(otherThreadSettled)

    requests.cancelApproval('cancelled')
    await expect(cancelled).resolves.toBe(false)
    expect(Object.keys(useToolApprovalRequests.getState().pending)).toEqual([
      'same-thread',
      'other-thread',
    ])
    expect(sameThreadSettled).not.toHaveBeenCalled()
    expect(otherThreadSettled).not.toHaveBeenCalled()

    requests.resolveApproval('same-thread', 'allow-once')
    requests.resolveApproval('other-thread', 'deny')
    await expect(sameThread).resolves.toBe(true)
    await expect(otherThread).resolves.toBe(false)
  })

  it('cancelApproval is a no-op for missing or already settled calls', async () => {
    const requests = useToolApprovalRequests.getState()
    const pending = requests.requestApproval('approved', 'tool-a', 'thread-1', 'github')
    requests.resolveApproval('approved', 'allow-always')
    const state = useToolApprovalRequests.getState()

    requests.cancelApproval('missing')
    requests.cancelApproval('approved')

    await expect(pending).resolves.toBe(true)
    expect(useToolApprovalRequests.getState()).toBe(state)
    expect(useToolApproval.getState().approvedServers).toEqual(['github'])
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
})

const tool = (server = 'alpha'): MCPTool => ({
  name: 'read', server, description: 'Read', inputSchema: { type: 'object' },
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const expectNoTrust = () => {
  const approval = useToolApproval.getState()
  expect(approval.approvedTools).toEqual({})
  expect(approval.approvedMCPTools).toEqual([])
  expect(approval.approvedServers).toEqual([])
  expect(approval.approvedToolsGlobal).toEqual([])
}

describe('validated approval lifecycle (real approval stores and identity validator)', () => {
  beforeEach(() => {
    useToolApprovalRequests.getState().clearPendingForThread('validated-thread')
    useToolApproval.setState({
      approvedTools: {}, approvedMCPTools: [], approvedServers: [],
      approvedToolsGlobal: [], allowAllMCPPermissions: false,
    })
  })

  const invalidInventories: [string, MCPTool[]][] = [
    ['disconnected', []],
    ['moved', [tool('beta')]],
    ['ambiguous', [tool(), tool('beta')]],
  ]

  it.each(invalidInventories)('denies %s identity before publishing a prompt', async (_reason, tools) => {
    const getTools = vi.fn().mockResolvedValue(tools)
    const requests = useToolApprovalRequests.getState()
    const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
    expect(useToolApprovalRequests.getState().pending.validated).toBeUndefined()
    await expect(result).resolves.toBe(false)
    expect(useToolApprovalRequests.getState().pending.validated).toBeUndefined()
    expectNoTrust()
  })

  it.each(['all', 'server', 'thread'] as const)('validates before the %s approval fast path', async (scope) => {
    const approval = useToolApproval.getState()
    if (scope === 'all') approval.setAllowAllMCPPermissions(true)
    if (scope === 'server') approval.approveServer('alpha')
    if (scope === 'thread') approval.approveToolForThread('validated-thread', 'read', 'alpha')
    const getTools = vi.fn().mockResolvedValue([])
    await expect(useToolApprovalRequests.getState().requestApproval(
      'validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false)
    )).resolves.toBe(false)
    expect(getTools).toHaveBeenCalledOnce()
    expect(useToolApprovalRequests.getState().pending.validated).toBeUndefined()
  })

  for (const decision of ['allow-once', 'allow-thread', 'allow-always'] as const) {
    it.each([...invalidInventories, ['disabled', [tool()]] as [string, MCPTool[]]])(
      `revalidates ${decision} and denies an identity that becomes %s after prompting`,
      async (reason, tools) => {
        const getTools = vi.fn().mockResolvedValue([tool()])
        let disabled = false
        const requests = useToolApprovalRequests.getState()
        const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
          () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => disabled))
        await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending.validated).toBeDefined())
        getTools.mockResolvedValue(tools)
        disabled = reason === 'disabled'
        requests.resolveApproval('validated', decision)
        await expect(result).resolves.toBe(false)
        expect(useToolApprovalRequests.getState().pending.validated).toBeUndefined()
        expectNoTrust()
      }
    )
  }

  for (const stage of ['before prompt', 'at decision'] as const) {
    for (const cancel of ['cancelApproval', 'clearPendingForThread'] as const) {
      it(`${cancel} ${stage} prevents late prompts and grants`, async () => {
        const inventory = deferred<MCPTool[]>()
        const getTools = vi.fn().mockResolvedValue([tool()])
        if (stage === 'before prompt') getTools.mockReturnValue(inventory.promise)
        const requests = useToolApprovalRequests.getState()
        const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
          () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
        if (stage === 'at decision') {
          await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending.validated).toBeDefined())
          getTools.mockReturnValue(inventory.promise)
          requests.resolveApproval('validated', 'allow-always')
        }
        requests[cancel](cancel === 'cancelApproval' ? 'validated' : 'validated-thread')
        await expect(result).resolves.toBe(false)
        inventory.resolve([tool()])
        await vi.waitFor(() => expect(getTools).toHaveBeenCalledTimes(stage === 'before prompt' ? 1 : 2))
        // Drain both the identity validator and the approval continuation.
        await new Promise((done) => setTimeout(done, 0))
        requests.resolveApproval('validated', 'allow-thread')
        expect(useToolApprovalRequests.getState().pending.validated).toBeUndefined()
        expectNoTrust()
      })
    }
  }

  it.each(['allow-once', 'deny'] as const)('duplicate decisions cannot widen a pending allow-once to trust (%s)', async (second) => {
    const inventory = deferred<MCPTool[]>()
    const getTools = vi.fn().mockResolvedValue([tool()])
    const requests = useToolApprovalRequests.getState()
    const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
    await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending.validated).toBeDefined())
    getTools.mockReturnValue(inventory.promise)
    requests.resolveApproval('validated', 'allow-once')
    requests.resolveApproval('validated', 'allow-always')
    requests.resolveApproval('validated', second)
    inventory.resolve([tool()])
    await expect(result).resolves.toBe(second !== 'deny')
    await new Promise((done) => setTimeout(done, 0))
    expect(getTools).toHaveBeenCalledTimes(2)
    expectNoTrust()
  })

  it('converts a synchronous validator throw into a denied approval', async () => {
    await expect(useToolApprovalRequests.getState().requestApproval(
      'validated', 'read', 'validated-thread', 'alpha',
      () => { throw new Error('identity unavailable') }
    )).resolves.toBe(false)
    expect(useToolApprovalRequests.getState().pending.validated).toBeUndefined()
    expectNoTrust()
  })

  it('a replaced call cannot publish or grant from its old validation', async () => {
    const inventory = deferred<MCPTool[]>()
    const requests = useToolApprovalRequests.getState()
    const old = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', () => inventory.promise, () => false))
    const replacement = requests.requestApproval('validated', 'write', 'validated-thread', 'beta')
    await expect(old).resolves.toBe(false)
    inventory.resolve([tool()])
    await new Promise((done) => setTimeout(done, 0))
    expect(useToolApprovalRequests.getState().pending.validated).toMatchObject({
      toolName: 'write', serverName: 'beta',
    })
    requests.resolveApproval('validated', 'deny')
    await expect(replacement).resolves.toBe(false)
    expectNoTrust()
  })

  it.each(['allow-thread', 'allow-always'] as const)('persists %s only after successful decision validation', async (decision) => {
    const inventory = deferred<MCPTool[]>()
    const getTools = vi.fn().mockResolvedValue([tool()])
    const requests = useToolApprovalRequests.getState()
    const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
    await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending.validated).toBeDefined())
    getTools.mockReturnValue(inventory.promise)
    requests.resolveApproval('validated', decision)
    expectNoTrust()
    inventory.resolve([tool()])
    await expect(result).resolves.toBe(true)
    expect(getTools).toHaveBeenCalledTimes(2)
    expect(useToolApproval.getState().isToolApproved('validated-thread', 'read', 'alpha')).toBe(true)
    expect(useToolApproval.getState().isToolApproved('other', 'other', 'alpha')).toBe(decision === 'allow-always')
  })
  it('Stop aborts the actual pending validation signal and prevents a prompt', async () => {
    let signal!: AbortSignal
    const result = useToolApprovalRequests.getState().requestApproval('validated', 'read', 'validated-thread', 'alpha', (validationSignal) => {
      signal = validationSignal
      return assertMcpIdentityAvailable('read', 'alpha', () => new Promise(() => {}), () => false, signal)
    })
    useToolApprovalRequests.getState().clearPendingForThread('validated-thread')
    await expect(result).resolves.toBe(false)
    expect(signal.aborted).toBe(true)
    expect(useToolApprovalRequests.getState().pending.validated).toBeUndefined()
    expectNoTrust()
  })

})
