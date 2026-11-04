import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { approvalKey, useToolApprovalRequests, type ApprovalResult } from '../useToolApprovalRequests'
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

  it('stores a pending approval keyed by threadId and toolCallId', () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    act(() => {
      result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })

    expect(result.current.pending[approvalKey('thread-1', 'tc1')]).toMatchObject({
      toolCallId: 'tc1',
      toolName: 'tool-a',
      threadId: 'thread-1',
    })
  })

  it('auto-resolves true (no pending) when allowAllMCPPermissions is set', async () => {
    useToolApproval.setState({ allowAllMCPPermissions: true })
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })

    await expect(p!).resolves.toBe(true)
    expect(result.current.pending[approvalKey('thread-1', 'tc1')]).toBeUndefined()
  })

  it('auto-resolves true (no pending) when the tool is already approved for the thread', async () => {
    act(() => {
      useToolApproval.getState().approveToolForThread('thread-1', 'tool-a')
    })
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })

    await expect(p!).resolves.toBe(true)
    expect(result.current.pending[approvalKey('thread-1', 'tc1')]).toBeUndefined()
  })

  it('resolveApproval allow-once resolves true without persisting the tool', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-once', 'thread-1')
    })

    await expect(p!).resolves.toBe(true)
    expect(useToolApproval.getState().isToolApproved('thread-1', 'tool-a')).toBe(false)
    expect(result.current.pending[approvalKey('thread-1', 'tc1')]).toBeUndefined()
  })

  it('resolveApproval allow-thread persists the tool for that thread only', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-thread', 'thread-1')
    })

    await expect(p!).resolves.toBe(true)
    const approval = useToolApproval.getState()
    expect(approval.isToolApproved('thread-1', 'tool-a')).toBe(true)
    expect(approval.isToolApproved('thread-2', 'tool-a')).toBe(false)
  })

  it('allow-thread preserves the server identity for subsequent requests', async () => {
    const requests = useToolApprovalRequests.getState()
    const initial = requests.requestApproval('first', 'read_file', 'thread-1', 'server-a')
    requests.resolveApproval('first', 'allow-thread', 'thread-1')
    await expect(initial).resolves.toBe(true)
    await expect(
      requests.requestApproval('same', 'read_file', 'thread-1', 'server-a')
    ).resolves.toBe(true)
    expect(useToolApprovalRequests.getState().pending).toEqual({})

    const other = requests.requestApproval('other', 'read_file', 'thread-1', 'server-b')
    expect(useToolApprovalRequests.getState().pending[approvalKey('thread-1', 'other')].serverName).toBe('server-b')
    requests.resolveApproval('other', 'deny', 'thread-1')
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
    expect(useToolApprovalRequests.getState().pending[approvalKey('thread-1', 'legacy')]).toBeDefined()
    requests.resolveApproval('legacy', 'deny', 'thread-1')
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

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1', 'github')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-always', 'thread-1')
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

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'allow-always', 'thread-1')
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

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1', 'github')
    })

    await expect(p!).resolves.toBe(true)
    expect(result.current.pending[approvalKey('thread-1', 'tc1')]).toBeUndefined()
  })

  it('keeps the server on the pending entry so the prompt can name it', () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    act(() => {
      result.current.requestApproval('tc1', 'tool-a', 'thread-1', 'github')
    })

    expect(result.current.pending[approvalKey('thread-1', 'tc1')]).toMatchObject({
      serverName: 'github',
    })
  })

  it('resolveApproval deny resolves false', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let p: Promise<ApprovalResult>
    act(() => {
      p = result.current.requestApproval('tc1', 'tool-a', 'thread-1')
    })
    act(() => {
      result.current.resolveApproval('tc1', 'deny', 'thread-1')
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

      requests.cancelApproval('cancelled', 'thread-1')
      await expect(pending).resolves.toBe(false)
      expect(useToolApprovalRequests.getState().pending[approvalKey('thread-1', 'cancelled')]).toBeUndefined()
      staleResolve('cancelled', decision, 'thread-1')

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

    requests.cancelApproval('cancelled', 'thread-1')
    await expect(cancelled).resolves.toBe(false)
    expect(Object.keys(useToolApprovalRequests.getState().pending)).toEqual([
      approvalKey('thread-1', 'same-thread'),
      approvalKey('thread-2', 'other-thread'),
    ])
    expect(sameThreadSettled).not.toHaveBeenCalled()
    expect(otherThreadSettled).not.toHaveBeenCalled()

    requests.resolveApproval('same-thread', 'allow-once', 'thread-1')
    requests.resolveApproval('other-thread', 'deny', 'thread-2')
    await expect(sameThread).resolves.toBe(true)
    await expect(otherThread).resolves.toBe(false)
  })

  it('cancelApproval is a no-op for missing or already settled calls', async () => {
    const requests = useToolApprovalRequests.getState()
    const pending = requests.requestApproval('approved', 'tool-a', 'thread-1', 'github')
    requests.resolveApproval('approved', 'allow-always', 'thread-1')
    const state = useToolApprovalRequests.getState()

    requests.cancelApproval('missing', 'thread-1')
    requests.cancelApproval('approved', 'thread-1')

    await expect(pending).resolves.toBe(true)
    expect(useToolApprovalRequests.getState()).toBe(state)
    expect(useToolApproval.getState().approvedServers).toEqual(['github'])
  })

  it('clearPendingForThread resolves matching promises false and removes only that thread', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())

    let pA: Promise<ApprovalResult>
    let pB: Promise<ApprovalResult>
    act(() => {
      pA = result.current.requestApproval('tcA', 'tool-a', 'thread-A')
      pB = result.current.requestApproval('tcB', 'tool-b', 'thread-B')
    })

    act(() => {
      result.current.clearPendingForThread('thread-A')
    })

    await expect(pA!).resolves.toBe(false)
    expect(result.current.pending[approvalKey('thread-A', 'tcA')]).toBeUndefined()
    expect(result.current.pending[approvalKey('thread-B', 'tcB')]).toMatchObject({ threadId: 'thread-B' })

    act(() => {
      result.current.resolveApproval('tcB', 'allow-once', 'thread-B')
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

    expect(result.current.pending[approvalKey('thread-A', 'tcA')]).toMatchObject({ threadId: 'thread-A' })
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
    const requests = useToolApprovalRequests.getState()
    for (const entry of Object.values(requests.pending)) {
      requests.clearPendingForThread(entry.threadId)
    }
    requests.clearPendingForThread('validated-thread')
    requests.clearPendingForThread('alpha-thread')
    requests.clearPendingForThread('beta-thread')
    useToolApproval.setState({
      approvedTools: {}, approvedMCPTools: [], approvedServers: [],
      approvedToolsGlobal: [], allowAllMCPPermissions: false,
    })
  })

  const invalidInventories: [string, MCPTool[]][] = [
    ['disconnected', []],
    ['moved', [tool('beta')]],
  ]

  it.each(invalidInventories)('denies %s identity before publishing a prompt', async (_reason, tools) => {
    const getTools = vi.fn().mockResolvedValue(tools)
    const requests = useToolApprovalRequests.getState()
    const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
    expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeUndefined()
    await expect(result).resolves.toMatchObject({ kind: 'validation-error', errorText: expect.any(String) })
    expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeUndefined()
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
    )).resolves.toMatchObject({ kind: 'validation-error' })
    expect(getTools).toHaveBeenCalledOnce()
    expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeUndefined()
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
        await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeDefined())
        getTools.mockResolvedValue(tools)
        disabled = reason === 'disabled'
        requests.resolveApproval('validated', decision, 'validated-thread')
        await expect(result).resolves.toMatchObject({ kind: 'validation-error' })
        expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeUndefined()
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
          await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeDefined())
          getTools.mockReturnValue(inventory.promise)
          requests.resolveApproval('validated', 'allow-always', 'validated-thread')
        }
        if (cancel === 'cancelApproval') requests.cancelApproval('validated', 'validated-thread')
        else requests.clearPendingForThread('validated-thread')
        await expect(result).resolves.toBe(false)
        inventory.resolve([tool()])
        await vi.waitFor(() => expect(getTools).toHaveBeenCalledTimes(stage === 'before prompt' ? 1 : 2))
        // Drain both the identity validator and the approval continuation.
        await new Promise((done) => setTimeout(done, 0))
        requests.resolveApproval('validated', 'allow-thread', 'validated-thread')
        expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeUndefined()
        expectNoTrust()
      })
    }
  }

  it('validates an explicit alpha binding despite a same-name beta rival and grants only alpha', async () => {
    const requests = useToolApprovalRequests.getState()
    const getTools = vi.fn().mockResolvedValue([tool(), tool('beta')])
    const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
    await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeDefined())
    requests.resolveApproval('validated', 'allow-thread', 'validated-thread')
    await expect(result).resolves.toBe(true)
    expect(getTools).toHaveBeenCalledTimes(2)
    expect(useToolApproval.getState().isToolApproved('validated-thread', 'read', 'alpha')).toBe(true)
    expect(useToolApproval.getState().isToolApproved('validated-thread', 'read', 'beta')).toBe(false)
  })

  it.each(['allow-once', 'deny'] as const)('duplicate decisions cannot widen a pending allow-once to trust (%s)', async (second) => {
    const inventory = deferred<MCPTool[]>()
    const getTools = vi.fn().mockResolvedValue([tool()])
    const requests = useToolApprovalRequests.getState()
    const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
    await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeDefined())
    getTools.mockReturnValue(inventory.promise)
    requests.resolveApproval('validated', 'allow-once', 'validated-thread')
    requests.resolveApproval('validated', 'allow-always', 'validated-thread')
    requests.resolveApproval('validated', second, 'validated-thread')
    inventory.resolve([tool()])
    await expect(result).resolves.toBe(second !== 'deny')
    await new Promise((done) => setTimeout(done, 0))
    expect(getTools).toHaveBeenCalledTimes(2)
    expectNoTrust()
  })

  it('distinguishes a synchronous validator failure from a user denial', async () => {
    await expect(useToolApprovalRequests.getState().requestApproval(
      'validated', 'read', 'validated-thread', 'alpha',
      () => { throw new Error('identity unavailable') }
    )).resolves.toEqual({ kind: 'validation-error', errorText: 'identity unavailable' })
    expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeUndefined()
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
    expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toMatchObject({
      toolName: 'write', serverName: 'beta',
    })
    requests.resolveApproval('validated', 'deny', 'validated-thread')
    await expect(replacement).resolves.toBe(false)
    expectNoTrust()
  })

  it.each(['allow-thread', 'allow-always'] as const)('persists %s only after successful decision validation', async (decision) => {
    const inventory = deferred<MCPTool[]>()
    const getTools = vi.fn().mockResolvedValue([tool()])
    const requests = useToolApprovalRequests.getState()
    const result = requests.requestApproval('validated', 'read', 'validated-thread', 'alpha',
      () => assertMcpIdentityAvailable('read', 'alpha', getTools, () => false))
    await vi.waitFor(() => expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeDefined())
    getTools.mockReturnValue(inventory.promise)
    requests.resolveApproval('validated', decision, 'validated-thread')
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
    expect(useToolApprovalRequests.getState().pending[approvalKey('validated-thread', 'validated')]).toBeUndefined()
    expectNoTrust()
  })

  it('keeps duplicate call IDs in two threads without replacement or decision/cancel cross-talk', async () => {
    const requests = useToolApprovalRequests.getState()
    const alpha = requests.requestApproval('shared', 'read', 'alpha-thread', 'alpha')
    const beta = requests.requestApproval('shared', 'read', 'beta-thread', 'beta')
    const alphaSettled = vi.fn()
    const betaSettled = vi.fn()
    void alpha.then(alphaSettled)
    void beta.then(betaSettled)
    await Promise.resolve()
    expect(alphaSettled).not.toHaveBeenCalled()
    expect(betaSettled).not.toHaveBeenCalled()
    expect(Object.keys(useToolApprovalRequests.getState().pending)).toEqual([
      approvalKey('alpha-thread', 'shared'), approvalKey('beta-thread', 'shared'),
    ])
    requests.resolveApproval('shared', 'allow-always', 'missing-thread')
    requests.cancelApproval('shared', 'missing-thread')
    requests.resolveApproval('shared', 'allow-thread', 'alpha-thread')
    await expect(alpha).resolves.toBe(true)
    expect(betaSettled).not.toHaveBeenCalled()
    expect(useToolApprovalRequests.getState().pending[approvalKey('beta-thread', 'shared')]).toMatchObject({ serverName: 'beta' })
    requests.cancelApproval('shared', 'alpha-thread')
    expect(useToolApprovalRequests.getState().pending[approvalKey('beta-thread', 'shared')]).toBeDefined()
    requests.cancelApproval('shared', 'beta-thread')
    await expect(beta).resolves.toBe(false)
    expect(useToolApproval.getState().isToolApproved('alpha-thread', 'read', 'alpha')).toBe(true)
    expect(useToolApproval.getState().isToolApproved('beta-thread', 'read', 'beta')).toBe(false)
    expect(useToolApprovalRequests.getState().pending).toEqual({})
  })

  it.each(['before prompt', 'at decision'] as const)('Stop isolates duplicate IDs with validators pending %s', async (stage) => {
    const requests = useToolApprovalRequests.getState()
    const alphaGate = deferred<void>()
    const betaGate = deferred<void>()
    let alphaSignal!: AbortSignal
    let betaSignal!: AbortSignal
    const alphaValidate = vi.fn((signal: AbortSignal) => {
      alphaSignal = signal
      return stage === 'before prompt' || alphaValidate.mock.calls.length > 1
        ? alphaGate.promise : Promise.resolve()
    })
    const betaValidate = vi.fn((signal: AbortSignal) => {
      betaSignal = signal
      return stage === 'before prompt' || betaValidate.mock.calls.length > 1
        ? betaGate.promise : Promise.resolve()
    })
    const alpha = requests.requestApproval('shared', 'read', 'alpha-thread', 'alpha', alphaValidate)
    const beta = requests.requestApproval('shared', 'read', 'beta-thread', 'beta', betaValidate)
    if (stage === 'at decision') {
      await vi.waitFor(() => expect(Object.keys(useToolApprovalRequests.getState().pending)).toHaveLength(2))
      requests.resolveApproval('shared', 'allow-always', 'alpha-thread')
      requests.resolveApproval('shared', 'allow-thread', 'beta-thread')
    }
    requests.clearPendingForThread('alpha-thread')
    await expect(alpha).resolves.toBe(false)
    expect(alphaSignal.aborted).toBe(true)
    expect(betaSignal.aborted).toBe(false)
    alphaGate.resolve()
    betaGate.resolve()
    await new Promise((done) => setTimeout(done, 0))
    expect(useToolApprovalRequests.getState().pending[approvalKey('alpha-thread', 'shared')]).toBeUndefined()
    if (stage === 'before prompt') {
      expect(useToolApprovalRequests.getState().pending[approvalKey('beta-thread', 'shared')]).toBeDefined()
      requests.resolveApproval('shared', 'allow-thread', 'beta-thread')
    }
    await expect(beta).resolves.toBe(true)
    expect(useToolApproval.getState().approvedServers).toEqual([])
    expect(useToolApproval.getState().isToolApproved('alpha-thread', 'read', 'alpha')).toBe(false)
    expect(useToolApproval.getState().isToolApproved('beta-thread', 'read', 'beta')).toBe(true)
    expect(useToolApproval.getState().isToolApproved('alpha-thread', 'read', 'beta')).toBe(false)
    expect(useToolApprovalRequests.getState().pending).toEqual({})
  })

  it.each(['allow-thread', 'allow-always'] as const)('duplicate-ID %s grants preserve alpha and beta identities', async (decision) => {
    const requests = useToolApprovalRequests.getState()
    const alpha = requests.requestApproval('shared', 'read', 'alpha-thread', 'alpha')
    const beta = requests.requestApproval('shared', 'read', 'beta-thread', 'beta')
    requests.resolveApproval('shared', decision, 'alpha-thread')
    await expect(alpha).resolves.toBe(true)
    expect(useToolApproval.getState().isToolApproved('beta-thread', 'read', 'beta')).toBe(false)
    expect(useToolApprovalRequests.getState().pending[approvalKey('beta-thread', 'shared')]).toMatchObject({ serverName: 'beta' })
    requests.resolveApproval('shared', decision, 'beta-thread')
    await expect(beta).resolves.toBe(true)
    const approval = useToolApproval.getState()
    expect(approval.isToolApproved('alpha-thread', 'read', 'alpha')).toBe(true)
    expect(approval.isToolApproved('beta-thread', 'read', 'beta')).toBe(true)
    expect(approval.isToolApproved('alpha-thread', 'read', 'beta')).toBe(decision === 'allow-always')
    expect(approval.isToolApproved('beta-thread', 'read', 'alpha')).toBe(decision === 'allow-always')
    expect(approval.approvedServers).toEqual(decision === 'allow-always' ? ['alpha', 'beta'] : [])
    expect(useToolApprovalRequests.getState().pending).toEqual({})
  })

})

describe('native elevated approvals (explicit native identity)', () => {
  const native = (grantKey: string) => ({ native: { grantKey } })
  beforeEach(() => {
    useToolApprovalRequests.setState({ pending: {} })
    useToolApproval.setState({
      approvedTools: {}, approvedMCPTools: [], approvedServers: [],
      approvedToolsGlobal: [], allowAllMCPPermissions: false,
    })
  })

  it('still prompts a native elevated call when the MCP blanket is on', () => {
    useToolApproval.setState({ allowAllMCPPermissions: true })
    void useToolApprovalRequests.getState().requestApproval('n1', 'skill_write', 'thread-1', undefined, undefined, native('g1'))
    expect(useToolApprovalRequests.getState().pending[approvalKey('thread-1', 'n1')]).toBeDefined()
  })

  it('does not treat a bare global or thread tool-name grant as a native approval', () => {
    useToolApproval.setState({ approvedToolsGlobal: ['shell'], approvedTools: { 'thread-1': ['shell'] } })
    void useToolApprovalRequests.getState().requestApproval('n2', 'shell', 'thread-1', undefined, undefined, native('g1'))
    expect(useToolApprovalRequests.getState().pending[approvalKey('thread-1', 'n2')]).toBeDefined()
  })

  it('leaves the MCP path unchanged: blanket and bare names still approve', async () => {
    useToolApproval.setState({ allowAllMCPPermissions: true })
    await expect(useToolApprovalRequests.getState().requestApproval('m1', 'fetch', 'thread-1', 'srv')).resolves.toBe(true)
    useToolApproval.setState({ allowAllMCPPermissions: false, approvedToolsGlobal: ['shell'] })
    await expect(useToolApprovalRequests.getState().requestApproval('m2', 'shell', 'thread-1')).resolves.toBe(true)
  })

  it('allow-once stores nothing; allow-thread/always persist only for the same native grant', async () => {
    const req = useToolApprovalRequests.getState()
    const once = req.requestApproval('o1', 'shell', 'thread-1', undefined, undefined, native('g1'))
    req.resolveApproval('o1', 'allow-once', 'thread-1')
    await expect(once).resolves.toBe(true)
    expect(useToolApproval.getState().approvedTools['thread-1']).toBeUndefined()

    const thread = req.requestApproval('t1', 'shell', 'thread-1', undefined, undefined, native('g1'))
    req.resolveApproval('t1', 'allow-thread', 'thread-1')
    await expect(thread).resolves.toBe(true)
    expect(useToolApproval.getState().approvedTools['thread-1']).toEqual(['native:shell:g1'])
    // same grant: approved without a prompt; changed grant: prompts again
    await expect(req.requestApproval('t2', 'shell', 'thread-1', undefined, undefined, native('g1'))).resolves.toBe(true)
    void req.requestApproval('t3', 'shell', 'thread-1', undefined, undefined, native('g2'))
    expect(useToolApprovalRequests.getState().pending[approvalKey('thread-1', 't3')]).toBeDefined()

    const always = req.requestApproval('a1', 'skill_write', 'thread-2', undefined, undefined, native('g1'))
    req.resolveApproval('a1', 'allow-always', 'thread-2')
    await always
    expect(useToolApproval.getState().approvedToolsGlobal).toEqual(['native:skill_write:g1'])
    // a bare MCP tool of the same name is not approved by the native choice
    expect(useToolApproval.getState().isToolApproved('thread-9', 'skill_write')).toBe(false)
  })

  it('does not auto-approve extension tools when allowAllMCPPermissions is set', () => {
    useToolApproval.setState({ allowAllMCPPermissions: true })
    const { result } = renderHook(() => useToolApprovalRequests())
    act(() => {
      result.current.requestApproval('tc1', 'x_tool', 'thread-1', 'ext:acme.one')
    })
    expect(result.current.pending[approvalKey('thread-1', 'tc1')]).toBeDefined()
  })

  const ext = (generation: number) => ({ extension: { generation } })

  it('keeps an allow-thread approval with the extension that got it', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'x_tool', 'thread-1', 'ext:acme.one', undefined, ext(1))
    })
    act(() => result.current.resolveApproval('tc1', 'allow-thread', 'thread-1'))
    await expect(p!).resolves.toBe(true)
    // The same tool name from another extension, or from an MCP server, asks.
    act(() => {
      result.current.requestApproval('tc2', 'x_tool', 'thread-1', 'ext:acme.two', undefined, ext(1))
      result.current.requestApproval('tc3', 'x_tool', 'thread-1', 'mcp-server')
      result.current.requestApproval('tc4', 'x_tool', 'thread-1')
    })
    expect(Object.keys(result.current.pending).sort()).toEqual(
      ['tc2', 'tc3', 'tc4'].map((id) => approvalKey('thread-1', id)).sort()
    )
    // The extension that was approved is not asked again, in that thread only.
    let again: Promise<boolean>
    act(() => {
      again = result.current.requestApproval('tc5', 'x_tool', 'thread-1', 'ext:acme.one', undefined, ext(1))
    })
    await expect(again!).resolves.toBe(true)
    act(() => {
      result.current.requestApproval('tc6', 'x_tool', 'thread-2', 'ext:acme.one', undefined, ext(1))
    })
    expect(result.current.pending[approvalKey('thread-2', 'tc6')]).toBeDefined()
  })

  it('keeps an allow-always approval to the one extension tool that got it', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'always_tool', 'thread-1', 'ext:acme.one', undefined, ext(1))
    })
    act(() => result.current.resolveApproval('tc1', 'allow-always', 'thread-1'))
    await expect(p!).resolves.toBe(true)
    expect(useToolApproval.getState().approvedServers).toEqual([])
    // Another tool of the same extension (one an update added, say) asks.
    act(() => {
      result.current.requestApproval('tc2', 'other_tool', 'thread-1', 'ext:acme.one', undefined, ext(1))
    })
    expect(Object.keys(result.current.pending)).toEqual([approvalKey('thread-1', 'tc2')])
    // The approved tool runs without asking, in any thread.
    let again: Promise<boolean>
    act(() => {
      again = result.current.requestApproval('tc3', 'always_tool', 'thread-2', 'ext:acme.one', undefined, ext(1))
    })
    await expect(again!).resolves.toBe(true)
  })

  it('never carries an extension grant to a rebound handler, and never persists it', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    for (const [id, decision] of [['a1', 'allow-always'], ['a2', 'allow-thread']] as const) {
      let p: Promise<boolean>
      act(() => {
        p = result.current.requestApproval(id, `t_${id}`, 'thread-1', 'ext:acme.one', undefined, ext(1))
      })
      act(() => result.current.resolveApproval(id, decision, 'thread-1'))
      await expect(p!).resolves.toBe(true)
    }
    // Nothing process-local reaches the persisted approval store.
    const stored = useToolApproval.getState()
    expect(stored.approvedTools).toEqual({})
    expect(stored.approvedMCPTools).toEqual([])
    expect(stored.approvedToolsGlobal).toEqual([])
    expect(stored.approvedServers).toEqual([])
    // The same extension tool rebound under a new generation asks again.
    act(() => {
      result.current.requestApproval('b1', 't_a1', 'thread-1', 'ext:acme.one', undefined, ext(2))
      result.current.requestApproval('b2', 't_a2', 'thread-1', 'ext:acme.one', undefined, ext(2))
    })
    expect(Object.keys(result.current.pending).sort()).toEqual(
      ['b1', 'b2'].map((id) => approvalKey('thread-1', id)).sort()
    )
  })

  it('treats a request with no generation as allow-once only', async () => {
    const { result } = renderHook(() => useToolApprovalRequests())
    let p: Promise<boolean>
    act(() => {
      p = result.current.requestApproval('tc1', 'once_tool', 'thread-1', 'ext:acme.one')
    })
    act(() => result.current.resolveApproval('tc1', 'allow-always', 'thread-1'))
    await expect(p!).resolves.toBe(true)
    act(() => {
      result.current.requestApproval('tc2', 'once_tool', 'thread-1', 'ext:acme.one')
      result.current.requestApproval('tc3', 'once_tool', 'thread-1', 'ext:acme.one', undefined, ext(1))
    })
    expect(Object.keys(result.current.pending).sort()).toEqual(
      ['tc2', 'tc3'].map((id) => approvalKey('thread-1', id)).sort()
    )
  })
})
