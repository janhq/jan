import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreads } from '../useThreads'
import { resolveConversationCapabilities } from '@/lib/conversationCapabilities'
import { useChatPermissions } from '../useChatPermissions'

const { persist, updateThread, deleteNative, toastError, revokeHost, stopAllMonitors, calls } =
  vi.hoisted(() => {
    const calls: string[] = []
    return {
      calls,
      persist: vi.fn(),
      updateThread: vi.fn(),
      deleteNative: vi.fn(),
      toastError: vi.fn(),
      revokeHost: vi.fn(),
      stopAllMonitors: vi.fn(),
    }
  })

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ threads: () => ({ setConversationCapabilities: persist, updateThread, deleteThread: deleteNative }) }),
}))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/lib/agentTools', () => ({
  cleanupThreadWorkspace: vi.fn(),
  cancelAgentThreadBash: vi.fn(),
  stopAgentSessionMonitors: vi.fn(),
  revokeThreadCapabilitiesInHost: revokeHost,
  stopAllThreadAgentMonitors: stopAllMonitors,
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
vi.mock('@janhq/core', () => ({ VectorDBExtension: class {}, EngineManager: { instance: () => ({ get: () => undefined }) } }))

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

// No grant of its own: no folder, with the app-wide network and memory setting
// (on by default) overlaid.
const noGrant = { ...resolveConversationCapabilities(undefined), shellNetwork: true, memoryWrite: true }

const save = (value: unknown, id = 'chat') =>
  useThreads.getState().setConversationCapabilities(id, value)

// These tests exercise the real fail-closed resolver rather than duplicating
// its validation rules in a mock. Its detailed input matrix lives with the lib.
describe('useThreads conversation capabilities', () => {
  it('preserves untouched metadata shape while the getter supplies default permissions', () => {
    const store = useThreads.getState()
    const untouched = thread('untouched-no-capabilities', { unrelated: 'keep' })
    store.setThreads([untouched])
    expect(useThreads.getState().threads[untouched.id].metadata).toEqual({ unrelated: 'keep' })
    expect(useThreads.getState().getConversationCapabilities(untouched.id)).toEqual(noGrant)
  })

  beforeEach(() => {
    vi.resetAllMocks()
    // These tests are about the per-conversation grant (the folder). The
    // app-wide network and memory setting is pinned on, its default, so a grant
    // reads back as written; the overlay has its own test below.
    useChatPermissions.setState({ shellNetwork: true, memoryWrite: true })
    deleteNative.mockResolvedValue(undefined)
    calls.length = 0
    revokeHost.mockImplementation(async (id: string) => {
      calls.push(`narrow:${id}`)
    })
    persist.mockImplementation(async (id: string) => {
      calls.push(`persist:${id}`)
    })
    stopAllMonitors.mockImplementation(async (id: string) => {
      calls.push(`stopAll:${id}`)
    })
    useThreads.setState({
      threads: { chat: thread() },
      currentThreadId: 'chat',
      searchIndex: null,
    })
  })

  // The native monitor loop cannot read this store; it reads host-confirmed
  // consent. So a revocation has to reach the host before anything is written,
  // and before the save queue, or a background poll keeps running under the
  // grant being replaced.
  // The host never acknowledged the narrow: NEITHER narrow path ran, so
  // background polls may still hold the old grant. The write must reject with
  // the structured error (so the surface can say so truthfully), attempt a
  // plain stop, persist nothing, and keep the denied overlay -- never restore.
  it('overlays the app-wide network and memory setting on the conversation grant, never the folder', async () => {
    useChatPermissions.setState({ shellNetwork: true, memoryWrite: true })
    // A conversation that granted nothing still gets the app-wide setting...
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual({
      version: 1,
      folderScope: null,
      shellNetwork: true,
      memoryWrite: true,
    })
    // ...and switching it off removes the capability everywhere at once, while
    // the folder remains a per-conversation matter.
    useChatPermissions.setState({ shellNetwork: false, memoryWrite: true })
    const caps = useThreads.getState().getConversationCapabilities('chat')
    expect(caps.shellNetwork).toBe(false)
    expect(caps.memoryWrite).toBe(true)
    expect(caps.folderScope).toBeNull()
  })

  it('a failed host ACK rejects structurally, attempts a stop, and persists nothing', async () => {
    revokeHost.mockRejectedValueOnce(new Error('ipc bridge down'))
    await expect(save(granted)).rejects.toMatchObject({
      name: 'HostRevokeUnconfirmedError',
      // Granting from default: nothing existed for background work to keep.
      backgroundMayPersist: false,
    })
    expect(calls).toEqual(['stopAll:chat'])
    expect(useThreads.getState().getConversationCapabilities('chat').folderScope).toBeNull()
    expect(
      useThreads.getState().threads.chat.metadata?.conversationCapabilities
    ).toEqual({ version: 1, folderScope: null, shellNetwork: false, memoryWrite: false })
  })

  // The first failed revoke erases the overlay and the optimistic metadata --
  // the exact state a retry would read -- so the prior-grant fact must be
  // sticky until the host acknowledges a save end to end.
  it('host uncertainty is sticky across retries and cleared by an acknowledged save', async () => {
    const id = 'sticky'
    useThreads.setState((state) => ({
      threads: { ...state.threads, [id]: { ...state.threads.chat, id } },
    }))
    await save(granted, id)
    revokeHost.mockRejectedValueOnce(new Error('bridge down'))
    await expect(save(null, id)).rejects.toMatchObject({ backgroundMayPersist: true })
    // Retry from the already-erased state: still uncertain.
    revokeHost.mockRejectedValueOnce(new Error('still down'))
    await expect(save(null, id)).rejects.toMatchObject({ backgroundMayPersist: true })
    // An acknowledged save resolves it...
    await save(null, id)
    // ...so a later failure with nothing granted is plain again.
    revokeHost.mockRejectedValueOnce(new Error('down again'))
    await expect(save(granted, id)).rejects.toMatchObject({ backgroundMayPersist: false })
  })

  // The bot-found reorder: grant A awaits its own host narrow while revoke B
  // starts and narrows first. A must never reach the strict setter -- the
  // setter would re-confirm A's grant (narrow + write + confirm of A's value),
  // leaving host and disk authorizing it even though B already denied, and
  // indefinitely so if B then fails before its own persist.
  it('a superseded grant can never reach the strict setter', async () => {
    const narrowA = deferred()
    const narrowB = deferred()
    revokeHost
      .mockImplementationOnce(async () => {
        await narrowA.promise
      })
      .mockImplementationOnce(async () => {
        await narrowB.promise
      })
    const saveA = save(granted)
    const saveB = save(null)
    // B's narrow reaches the host first; then A's resolves.
    narrowB.resolve()
    narrowA.resolve()
    // B's persist fails AFTER A was superseded -- the dangerous interleaving.
    persist.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(saveA).rejects.toThrow('Conversation changed while saving permissions')
    await expect(saveB).rejects.toThrow('disk unavailable')
    // The strict setter saw exactly one request: B's denial. A's grant never
    // reached it, so neither the host mirror nor the disk ever confirmed A.
    expect(persist).toHaveBeenCalledExactlyOnceWith(
      'chat',
      expect.objectContaining({ shellNetwork: false, memoryWrite: false, folderScope: null })
    )
  })

  // An acknowledged narrow proves the host denied, whatever the persist does:
  // uncertainty must clear then, not only after a fully successful save.
  it('an acknowledged narrow clears uncertainty even when the persist then fails', async () => {
    const id = 'ack-clears'
    useThreads.setState((state) => ({
      threads: { ...state.threads, [id]: { ...state.threads.chat, id } },
    }))
    await save(granted, id)
    revokeHost.mockRejectedValueOnce(new Error('bridge down'))
    await expect(save(null, id)).rejects.toMatchObject({ backgroundMayPersist: true })
    // Retry: the narrow is acknowledged, then the persist fails.
    persist.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(save(null, id)).rejects.toThrow('disk unavailable')
    // The host is proven denied, so a later ACK failure with nothing granted
    // is plain -- warning here would be the over-warn the bot flagged.
    revokeHost.mockRejectedValueOnce(new Error('bridge down'))
    await expect(save(granted, id)).rejects.toMatchObject({ backgroundMayPersist: false })
  })

  // Reviewer residual: a revoke superseding an IN-FLIGHT grant reads only the
  // grant's optimistic deny, yet that grant's persist may land -- and
  // host-confirm -- after it. If the revoke then fails, the user-approved
  // grant can be live while a plain copy claims everything is off.
  it('a revoke superseding an in-flight grant stays uncertain when it fails', async () => {
    const id = 'inflight'
    useThreads.setState((state) => ({
      threads: { ...state.threads, [id]: { ...state.threads.chat, id } },
    }))
    const pendingPersist = deferred()
    persist.mockReturnValueOnce(pendingPersist.promise)
    const saveA = save(granted, id)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    // B revokes while A's persist is in flight; B's narrow fails. B now also
    // drains A before settling, so A must be released before awaiting B.
    revokeHost.mockRejectedValueOnce(new Error('bridge down'))
    const saveB = expect(save(null, id)).rejects.toMatchObject({
      backgroundMayPersist: true,
    })
    pendingPersist.resolve()
    await saveB
    // A lands host-side but is superseded, so its overlay never applies.
    await expect(saveA).rejects.toThrow('Conversation changed while saving permissions')
  })

  // The in-flight tracking must not over-warn: a request that provably never
  // reached the strict setter cannot have been confirmed, so a repeated grant
  // attempt from default stays plain.
  it('a repeated grant attempt after an ACK failure stays plain', async () => {
    const id = 'replain'
    useThreads.setState((state) => ({
      threads: { ...state.threads, [id]: { ...state.threads.chat, id } },
    }))
    revokeHost.mockRejectedValueOnce(new Error('bridge down'))
    await expect(save(granted, id)).rejects.toMatchObject({ backgroundMayPersist: false })
    revokeHost.mockRejectedValueOnce(new Error('bridge down'))
    await expect(save(granted, id)).rejects.toMatchObject({ backgroundMayPersist: false })
  })

  // The authority-ordering proof the coordinator mandated, frontend half: the
  // authoritative narrow must fire only after an in-flight predecessor has
  // settled (so no request of ours can confirm after it) and before our own
  // persist. The native half -- a narrow is never restored by a failed or
  // absent write -- is mutation-proven in the plugin suite. Together: A
  // in-flight setter + B ack + A confirm + B persist failure => host DENIED.
  it('a revoke re-narrows the host after an in-flight predecessor settles, before persisting', async () => {
    const id = 'renarrow'
    useThreads.setState((state) => ({
      threads: { ...state.threads, [id]: { ...state.threads.chat, id } },
    }))
    const pendingPersist = deferred()
    persist.mockReturnValueOnce(pendingPersist.promise)
    const saveA = save(granted, id)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    calls.length = 0
    // B revokes while A's persist is in flight; B's own persist will fail.
    persist.mockRejectedValueOnce(new Error('disk unavailable'))
    const saveB = expect(save(null, id)).rejects.toThrow('disk unavailable')
    // Immediate best-effort narrow only -- B must NOT persist or re-narrow
    // while A can still confirm.
    await vi.waitFor(() => expect(calls).toEqual([`narrow:${id}`]))
    // A settles (host-side it confirmed its grant); B must now narrow AGAIN
    // before its own (failing) persist.
    pendingPersist.resolve()
    await expect(saveA).rejects.toThrow('Conversation changed while saving permissions')
    await saveB
    expect(calls).toEqual([`narrow:${id}`, `narrow:${id}`])
    expect(persist).toHaveBeenCalledTimes(2)
  })

  // Reviewer chain-break: a revoke that fails at its FIRST narrow must not
  // settle while its predecessor's native call is still in flight -- a
  // successor reads "predecessor settled" (or finds no entry at all) as "no
  // older native call of ours can still confirm", and re-narrows on that
  // premise. Without the drain, Z's late confirm postdates B's authoritative
  // ack and the user-revoked grant is host-live again.
  it('an early-failing revoke still drains its in-flight predecessor before settling', async () => {
    const id = 'chain'
    useThreads.setState((state) => ({
      threads: { ...state.threads, [id]: { ...state.threads.chat, id } },
    }))
    const pendingPersist = deferred()
    persist.mockReturnValueOnce(pendingPersist.promise)
    const saveZ = expect(save(granted, id)).rejects.toThrow(
      'Conversation changed while saving permissions'
    )
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    revokeHost.mockRejectedValueOnce(new Error('bridge blip'))
    let aSettled = false
    const saveA = save(null, id).catch((error) => {
      aSettled = true
      return error
    })
    // Give A every chance to (wrongly) settle while Z is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(aSettled).toBe(false)
    pendingPersist.resolve()
    const errA = await saveA
    expect(errA).toMatchObject({
      name: 'HostRevokeUnconfirmedError',
      backgroundMayPersist: true,
    })
    await saveZ
  })

  // Verifier coverage gap: the sticky delete must sit AFTER the authoritative
  // (post-predecessor) narrow. A revoke's best-effort first ack must not clear
  // uncertainty while an elevated predecessor is still in flight -- a third
  // request racing into that window reads the sticky set for its own warning.
  it('uncertainty survives the best-effort ack until the authoritative narrow', async () => {
    const id = 'window'
    useThreads.setState((state) => ({
      threads: { ...state.threads, [id]: { ...state.threads.chat, id } },
    }))
    // Z: a grant whose persist hangs in flight.
    const pendingPersist = deferred()
    persist.mockReturnValueOnce(pendingPersist.promise)
    const saveZ = expect(save(granted, id)).rejects.toThrow(
      'Conversation changed while saving permissions'
    )
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    // A: revoke whose narrow fails -> sticky set (after its stopAll await)
    // while Z is in flight. Wait for the stopAll marker plus a macrotask so
    // the sticky add has provably executed before B's ack can clear anything.
    revokeHost.mockRejectedValueOnce(new Error('bridge blip'))
    const saveA = expect(save(null, id)).rejects.toMatchObject({
      backgroundMayPersist: true,
    })
    await vi.waitFor(() => expect(calls).toContain(`stopAll:${id}`))
    await new Promise((resolve) => setTimeout(resolve, 0))
    // B: revoke whose best-effort first narrow acks ONLY NOW -- strictly
    // after A's sticky add -- then waits on A/Z. An early (pre-predecessor)
    // delete here would clear a REAL sticky entry.
    const bNarrow = deferred()
    revokeHost.mockImplementationOnce(() => bNarrow.promise)
    const saveB = expect(save(null, id)).rejects.toThrow(
      'Conversation changed while saving permissions'
    )
    bNarrow.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // C: races into the window; its narrow fails. It must still warn -- the
    // sticky set may only clear on an ack that postdates every confirm, and
    // B has not reached its authoritative narrow (it is draining A and Z).
    revokeHost.mockRejectedValueOnce(new Error('bridge blip'))
    const saveC = expect(save(null, id)).rejects.toMatchObject({
      backgroundMayPersist: true,
    })
    pendingPersist.resolve()
    await Promise.all([saveZ, saveA, saveB, saveC])
  })

  it('narrows the host before it persists', async () => {
    await save(granted)
    expect(calls).toEqual(['narrow:chat', 'persist:chat'])
  })

  it('narrows the host without waiting for an earlier queued save', async () => {
    const pending = deferred()
    persist.mockImplementationOnce(async () => {
      calls.push('persist:first')
      await pending.promise
    })
    const first = save(granted)
    await Promise.resolve()
    // Revoke while the first write is still in flight.
    const second = save(undefined)
    await vi.waitFor(() => expect(calls).toContain('narrow:chat'))
    expect(
      calls.filter((c) => c.startsWith('narrow')).length
    ).toBeGreaterThanOrEqual(2)
    // The host was narrowed although the first persist has not resolved.
    expect(calls).not.toContain('persist:chat')
    pending.resolve()
    // The revoke superseded the in-flight grant, so the grant must refuse to
    // report success; only the revoke is allowed to complete.
    await expect(first).rejects.toThrow('Conversation changed')
    await second
  })

  it('does not persist or report a revocation the host refused', async () => {
    revokeHost.mockRejectedValueOnce(new Error('host unreachable'))
    // The raw transport error is wrapped: the surface needs to distinguish
    // "the host never acknowledged" from an ordinary failed save.
    await expect(save(granted)).rejects.toMatchObject({
      name: 'HostRevokeUnconfirmedError',
      hostCause: expect.objectContaining({ message: 'host unreachable' }),
    })
    expect(persist).not.toHaveBeenCalled()
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(
      noGrant
    )
  })

  it('restores host-sanitized persisted read/write access on bootstrap or reload', async () => {
    const id = 'unconfirmed-bootstrap'
    useThreads.getState().setThreads([thread(id, { conversationCapabilities: granted })])
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual(granted)
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
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual(noGrant)
    useThreads.getState().setThreads([thread(id, { conversationCapabilities: granted })])
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual(noGrant)
  })

  it('restores saved read-only access without widening to write', () => {
    const id = 'saved-read-bootstrap'
    const read = { ...granted, folderScope: { ...granted.folderScope, access: 'read' } }
    useThreads.getState().setThreads([thread(id, { conversationCapabilities: read })])
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual(read)
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

  it('drops a superseded save before it persists; only the newest request lands', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const first = expect(save(granted)).rejects.toThrow('Conversation changed')
    const second = save(null)
    // The superseded grant must never reach the strict setter: persisting it
    // would have the native side re-confirm a value the user already
    // replaced. Only the newest request's value may land.
    pending.resolve()
    await Promise.all([first, second])
    expect(persist).toHaveBeenCalledExactlyOnceWith(
      'chat',
      resolveConversationCapabilities(null)
    )
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

  it('does not let a failed save block its successor', async () => {
    const pending = deferred()
    persist.mockReturnValueOnce(pending.promise)
    const first = expect(save(undefined)).rejects.toThrow('disk failure')
    // Let the first request reach its persist before the successor starts,
    // so the failure exercised is the write's own, not a supersession.
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
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
    // Let the first write get past its host narrowing and into persistence, so
    // the second is genuinely queued behind an in-flight write.
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
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
      .toEqual(noGrant)
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
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(noGrant)
  })

  it('bulk deletion keeps authoritative grants for retained favorites', async () => {
    useThreads.setState({ threads: { chat: { ...thread(), isFavorite: true }, other: thread('other') } })
    await save(granted)
    await save(granted, 'other')
    useThreads.getState().deleteAllThreads()
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(granted)
    useThreads.getState().setThreads([{ ...thread(), isFavorite: true }, thread('other')])
    expect(useThreads.getState().getConversationCapabilities('chat')).toEqual(granted)
    expect(useThreads.getState().getConversationCapabilities('other')).toEqual(noGrant)
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
    expect(authorityDuringDelete).toEqual(noGrant)
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
      noGrant
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
    // Nothing was restored (the recreated record kept precedence), so the
    // failure copy must not claim a restoration.
    expect(toastError.mock.calls[0][1]?.description).not.toContain('restored')
  })

  it('a failed second delete of an already-gone thread does not claim a restore', async () => {
    useThreads.getState().deleteThread('chat')
    // Let the first (successful) native call settle before arming the failure.
    await vi.waitFor(() => expect(deleteNative).toHaveBeenCalledTimes(1))
    deleteNative.mockRejectedValueOnce(new Error('not found'))
    // Second click: the record is already gone from state, so there is no
    // snapshot to restore and the toast must not say there was.
    useThreads.getState().deleteThread('chat')
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(useThreads.getState().threads.chat).toBeUndefined()
    expect(toastError.mock.calls[0][1]?.description).not.toContain('restored')
  })

})
