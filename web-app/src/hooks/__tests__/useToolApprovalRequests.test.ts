import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolApprovalRequests } from '../useToolApprovalRequests'
import { useToolApproval } from '../useToolApproval'

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
})
