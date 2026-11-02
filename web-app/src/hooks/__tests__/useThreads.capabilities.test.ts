import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreads } from '../useThreads'
import { resolveConversationCapabilities } from '@/lib/conversationCapabilities'

const { persist, updateThread, deleteNative, toastError } = vi.hoisted(() => ({
  persist: vi.fn(),
  updateThread: vi.fn(),
  deleteNative: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ threads: () => ({ setConversationCapabilities: persist, updateThread, deleteThread: deleteNative }) }),
}))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/lib/agentTools', () => ({
  cleanupThreadWorkspace: vi.fn(),
  cancelAgentThreadBash: vi.fn(),
  stopAgentSessionMonitors: vi.fn(),
}))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: { getState: () => ({ removeThread: vi.fn() }) } }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => ({ removeSession: vi.fn() }) } }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: { getState: () => ({ clearThreadState: vi.fn() }) } }))
vi.mock('@/hooks/useCoworkSessions', () => ({
  useCoworkSessions: { getState: () => ({ sessions: [], deleteSession: vi.fn() }) },
}))
vi.mock('@/hooks/useCoworkRun', () => ({ useCoworkRun: {} }))
vi.mock('@/lib/coworkRunner', () => ({ abortRun: vi.fn() }))
vi.mock('@/lib/coworkMonitor', () => ({ dropMonitorLane: vi.fn() }))
vi.mock('@/lib/extension', () => ({ ExtensionManager: { getInstance: () => ({ get: () => undefined }) } }))
vi.mock('@janhq/core', () => ({ ExtensionTypeEnum: {}, VectorDBExtension: class {}, EngineManager: { instance: () => ({ get: () => undefined }) } }))

function thread(id = 'chat', metadata: Thread['metadata'] = {}): Thread {
  return { id, title: 'Conversation', assistants: [], updated: 123, metadata }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const granted = {
  version: 1,
  folderScope: { path: '/workspace/project', access: 'write' },
  shellNetwork: true,
  memoryWrite: true,
} as const

const save = (value: unknown, id = 'chat') =>
  useThreads.getState().setConversationCapabilities(id, value)

// These tests exercise the real fail-closed resolver rather than duplicating
// its validation rules in a mock. Its detailed input matrix lives with the lib.
describe('useThreads conversation capabilities', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    persist.mockResolvedValue(undefined)
    deleteNative.mockResolvedValue(undefined)
    useThreads.setState({
      threads: { chat: thread() },
      currentThreadId: 'chat',
      searchIndex: null,
    })
  })

  it('does not confirm persisted elevations on bootstrap or reload', async () => {
    const id = 'unconfirmed-bootstrap'
    useThreads.getState().setThreads([thread(id, { conversationCapabilities: granted })])
    expect(useThreads.getState().getConversationCapabilities(id))
      .toEqual(resolveConversationCapabilities(undefined))
    await save(granted, id)
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual(granted)
    useThreads.getState().setThreads([thread(id, { conversationCapabilities: granted })])
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual(granted)
  })

  it('failed reconfirmation cannot activate persisted grants', async () => {
    const id = 'failed-reconfirmation'
    useThreads.getState().setThreads([thread(id, { conversationCapabilities: granted })])
    persist.mockRejectedValueOnce(new Error('disk failure'))
    await expect(save(granted, id)).rejects.toThrow('disk failure')
    expect(useThreads.getState().getConversationCapabilities(id))
      .toEqual(resolveConversationCapabilities(undefined))
  })

  it('persists normalized capabilities while preserving unrelated metadata and thread fields', async () => {
    const original = thread('chat', {
      project: { id: 'project', name: 'Project', updated_at: 1 },
      titleSetManually: true,
      custom: { retained: true },
    })
    useThreads.setState({ threads: { chat: original } })
    await save(granted)
    const expected = {
      ...original,
      metadata: {
        ...original.metadata,
        conversationCapabilities: resolveConversationCapabilities(granted),
      },
    }
    expect(persist).toHaveBeenCalledExactlyOnceWith('chat', resolveConversationCapabilities(granted))
    expect(useThreads.getState().threads.chat).toEqual(expected)
    expect(useThreads.getState().currentThreadId).toBe('chat')
    expect(original.metadata).not.toHaveProperty('conversationCapabilities')
  })

  it.each([null, true, 'enabled', [], { tools: true }, { version: -1 }])(
    'normalizes malformed input %j to denied defaults',
    async (value) => {
      await save(value)
      expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
        .toEqual(resolveConversationCapabilities(undefined))
    }
  )

  it('rejects unknown threads without persistence', async () => {
    await expect(save(undefined, 'missing')).rejects.toThrow('Unknown thread')
    expect(persist).not.toHaveBeenCalled()
    expect(useThreads.getState().threads.missing).toBeUndefined()
  })

  it('rejects Cowork threads without persistence or mutation', async () => {
    const original = thread('cowork', { mode: 'cowork' })
    useThreads.setState({ threads: { cowork: original } })
    await expect(save(undefined, 'cowork')).rejects.toThrow('Cowork')
    expect(persist).not.toHaveBeenCalled()
    expect(useThreads.getState().threads.cowork).toBe(original)
  })

  it('does not expose capabilities before persistence succeeds', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const original = useThreads.getState().threads.chat
    const saving = save(undefined)
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities).toEqual(resolveConversationCapabilities(undefined))
    pending.resolve()
    await saving
    expect(useThreads.getState().threads.chat).not.toBe(original)
  })

  it('propagates persistence failure and leaves scoped authority denied', async () => {
    persist.mockRejectedValueOnce(new Error('disk failure'))
    await expect(save(undefined)).rejects.toThrow('disk failure')
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities).toEqual(resolveConversationCapabilities(undefined))
    await expect(save(undefined)).resolves.toBeUndefined()
  })

  it('serializes same-thread saves and preserves metadata added by a preceding save', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const first = expect(save(granted)).rejects.toThrow('Conversation changed')
    const second = save(null)
    expect(persist).toHaveBeenCalledTimes(1)
    pending.resolve()
    await Promise.all([first, second])
    expect(persist).toHaveBeenCalledTimes(2)
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(resolveConversationCapabilities(null))
  })

  it('captures validated input before caller mutation', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const value = { ...granted, folderScope: { ...granted.folderScope }, shellNetwork: Boolean(granted.shellNetwork) }
    const saving = save(value)
    value.folderScope.path = '/different/project'
    value.shellNetwork = false
    pending.resolve()
    await saving
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(granted)
  })

  it('does not block a different conversation on a pending write', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    useThreads.setState({ threads: { chat: thread(), other: thread('other') } })
    const first = save(granted)
    await save(undefined, 'other')
    expect(persist).toHaveBeenCalledTimes(2)
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities).toEqual(resolveConversationCapabilities(undefined))
    pending.resolve()
    await first
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(granted)
  })

  it('does not let a failed queued save block its successor', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const first = expect(save(undefined)).rejects.toThrow('disk failure')
    const second = save(null)
    pending.reject(new Error('disk failure'))
    await first
    await second
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite a newer thread snapshot when persistence completes', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const saving = save(undefined)
    const newer = thread('chat', {
      custom: 'newer',
      project: { id: 'new-project', name: 'Moved project', updated_at: 2 },
    })
    useThreads.setState({ threads: { chat: newer } })
    pending.resolve()
    await saving
    expect(useThreads.getState().threads.chat).toEqual({ ...newer, metadata: { ...newer.metadata, conversationCapabilities: resolveConversationCapabilities(undefined) } })
  })

  it('does not resurrect a deleted thread after persistence', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const saving = expect(save(undefined)).rejects.toThrow('Unknown thread')
    useThreads.setState({ threads: {} })
    pending.resolve()
    await saving
    expect(useThreads.getState().threads).toEqual({})
  })

  it('rechecks a queued thread before writing if it became Cowork', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const first = expect(save(undefined)).rejects.toThrow('Cowork')
    const second = expect(save(null)).rejects.toThrow('Cowork')
    useThreads.setState({ threads: { chat: thread('chat', { mode: 'cowork' }) } })
    pending.resolve()
    await Promise.all([first, second])
    expect(persist).toHaveBeenCalledTimes(1)
  })
  it('revokes synchronously while save waits and remains denied on failure', async () => {
    useThreads.setState({ threads: { chat: thread('chat', { conversationCapabilities: granted }) } })
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const saving = expect(save(null)).rejects.toThrow('disk')
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(resolveConversationCapabilities(undefined))
    pending.reject(new Error('disk'))
    await saving
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(resolveConversationCapabilities(undefined))
  })

  it('an earlier successful save cannot restore grants while a revoke is queued', async () => {
    const first = deferred()
    const second = deferred()
    persist.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const granting = expect(save(granted)).rejects.toThrow('Conversation changed')
    const revoking = save(null)
    first.resolve()
    await granting
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(resolveConversationCapabilities(undefined))
    second.resolve()
    await revoking
  })

  it('failed revocation remains denied after a same-process disk reload', async () => {
    persist.mockRejectedValueOnce(new Error('disk'))
    await expect(save(null)).rejects.toThrow('disk')
    useThreads.getState().setThreads([thread('chat', { conversationCapabilities: granted })])
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(resolveConversationCapabilities(undefined))
    await save(granted)
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities).toEqual(granted)
  })

  it('ordinary metadata updates cannot restore or introduce consent', async () => {
    await save(null)
    useThreads.getState().updateThread('chat', { metadata: { project: { id: 'moved', name: 'Moved', updated_at: 2 }, conversationCapabilities: granted } })
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(resolveConversationCapabilities(undefined))
    expect(useThreads.getState().threads.chat.metadata?.project?.id).toBe('moved')
  })

  it('successful revocation survives completion of a stale disk fetch', async () => {
    await save(null)
    useThreads.getState().setThreads([thread('chat', { conversationCapabilities: granted })])
    expect(useThreads.getState().getConversationCapabilities('chat'))
      .toEqual(resolveConversationCapabilities(undefined))
    expect(useThreads.getState().threads.chat.metadata?.conversationCapabilities)
      .toEqual(resolveConversationCapabilities(undefined))
  })

  it('an unrelated thread reload does not invalidate a pending save', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const saving = save(granted)
    useThreads.getState().setThreads([thread(), thread('unrelated')])
    pending.resolve()
    await saving
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(granted)
  })

  it.each(['favorite', 'project'])('bulk deletion preserves in-flight saves for retained %s threads', async (kind) => {
    const kept = thread('chat', kind === 'project' ? { project: { id: 'p', name: 'Project', updated_at: 1 } } : {})
    if (kind === 'favorite') kept.isFavorite = true
    useThreads.setState({ threads: { chat: kept } })
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const saving = save(granted)
    useThreads.getState().deleteAllThreads()
    pending.resolve()
    await saving
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(granted)
  })

  it.each(['single', 'bulk', 'clear'])('prunes deleted grants on %s deletion without leaking authority to reused IDs', async (kind) => {
    await save(granted)
    if (kind === 'single') useThreads.getState().deleteThread('chat')
    else if (kind === 'bulk') useThreads.getState().deleteAllThreads()
    else useThreads.getState().clearAllThreads()
    useThreads.getState().setThreads([thread('chat')])
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(resolveConversationCapabilities(undefined))
  })

  it('bulk deletion keeps authoritative grants for retained favorites', async () => {
    useThreads.setState({ threads: { chat: { ...thread(), isFavorite: true }, other: thread('other') } })
    await save(granted)
    await save(granted, 'other')
    useThreads.getState().deleteAllThreads()
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(granted)
    useThreads.getState().setThreads([{ ...thread(), isFavorite: true }, thread('other')])
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(granted)
    expect(useThreads.getState().getConversationCapabilities('other')).toEqual(resolveConversationCapabilities(undefined))
  })

  it('revokes grant authority before the native delete during project deletion', async () => {
    useThreads.setState({
      threads: { chat: thread('chat', { project: { id: 'p', name: 'P', updated_at: 1 } }) },
    })
    await save(granted)
    let authorityDuringDelete: unknown = 'unset'
    deleteNative.mockImplementationOnce(async () => {
      // Observed while the native delete is in flight: a concurrent dispatch
      // must already see default-deny, as on the single-delete path.
      authorityDuringDelete = useThreads.getState().getConversationCapabilities('chat')
    })
    await useThreads.getState().deleteAllThreadsByProject('p')
    expect(authorityDuringDelete).toEqual(resolveConversationCapabilities(undefined))
    expect(useThreads.getState().threads.chat).toBeUndefined()
  })

  it('restores the thread default-deny and surfaces a toast when the native delete fails', async () => {
    await save(granted)
    deleteNative.mockRejectedValueOnce(new Error('file locked'))
    useThreads.getState().deleteThread('chat')
    expect(useThreads.getState().threads.chat).toBeUndefined()
    await vi.waitFor(() => expect(useThreads.getState().threads.chat).toBeTruthy())
    expect(toastError).toHaveBeenCalledOnce()
    // The restored thread holds no authority until the user consents again,
    // even though its on-disk metadata may still carry the stale grant.
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(
      resolveConversationCapabilities(undefined)
    )
  })

  it('a successful native delete restores nothing and shows no toast', async () => {
    useThreads.getState().deleteThread('chat')
    await Promise.resolve()
    await Promise.resolve()
    expect(useThreads.getState().threads.chat).toBeUndefined()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a late failed-delete restore never clobbers a thread recreated with the same id', async () => {
    deleteNative.mockRejectedValueOnce(new Error('file locked'))
    useThreads.getState().deleteThread('chat')
    const recreated = thread('chat', { custom: 'recreated' })
    useThreads.setState({ threads: { chat: recreated } })
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(useThreads.getState().threads.chat).toBe(recreated)
  })

})
