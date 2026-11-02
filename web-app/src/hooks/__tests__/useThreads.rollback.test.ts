import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreads } from '../useThreads'

const { disk, remove, messages, sessions } = vi.hoisted(() => ({
  disk: new Map<string, Thread>(), remove: vi.fn(), messages: new Map<string, unknown[]>(), sessions: {} as Record<string, unknown>,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    path: () => ({ sep: () => '/' }),
    threads: () => ({
      createThread: async (thread: Thread) => { disk.set(thread.id, structuredClone(thread)); return thread },
      rollbackCreatedThread: remove,
      releaseCreatedThread: vi.fn(),
      updateThread: vi.fn(),
      setConversationCapabilities: async () => { throw new Error("consent failed") },
    }),
  }),
}))
vi.mock('@/hooks/useMessages', () => ({ useMessages: { getState: () => ({ getMessages: (id: string) => messages.get(id) ?? [] }) } }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => ({ sessions }) } }))
vi.mock('@/lib/agentTools', () => ({ cleanupThreadWorkspace: vi.fn(), cancelAgentThreadBash: vi.fn(), stopAgentSessionMonitors: vi.fn() }))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: {} }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: {} }))
vi.mock('@/hooks/useCoworkSessions', () => ({ useCoworkSessions: {} }))
vi.mock('@/hooks/useCoworkRun', () => ({ useCoworkRun: {} }))
vi.mock('@/lib/coworkRunner', () => ({ abortRun: vi.fn() }))
vi.mock('@/lib/coworkMonitor', () => ({ dropMonitorLane: vi.fn() }))
vi.mock('@/lib/extension', () => ({ ExtensionManager: {} }))
vi.mock('@janhq/core', () => ({ ExtensionTypeEnum: {}, VectorDBExtension: class {} }))

const create = () => useThreads.getState().createThread({ id: 'model', provider: 'test' })
const rollback = (id: string) => useThreads.getState().rollbackCreatedThread(id, 'prior')

describe('created chat rollback', () => {
  beforeEach(() => {
    disk.clear(); messages.clear()
    for (const id of Object.keys(sessions)) delete sessions[id]
    remove.mockReset().mockImplementation(async (id: string) => { disk.delete(id) })
    useThreads.setState({ threads: { prior: { id: 'prior', title: 'Prior', updated: 1 } }, currentThreadId: 'prior', searchIndex: null })
  })

  it('repeated failed-consent retries leave neither disk nor store orphans', async () => {
    for (let retry = 0; retry < 4; retry++) {
      const thread = await create()
      expect(disk.has(thread.id)).toBe(true)
      expect(useThreads.getState().threads[thread.id]).toBeDefined()
      await rollback(thread.id)
      expect(disk.size).toBe(0)
      expect(Object.keys(useThreads.getState().threads)).toEqual(['prior'])
      expect(useThreads.getState().currentThreadId).toBe('prior')
      expect(useThreads.getState().getFilteredThreads('New')).toEqual([])
    }
  })

  it('awaits disk deletion before removing store and preserves a concurrent switch', async () => {
    const thread = await create()
    let finish!: () => void
    remove.mockImplementationOnce(async (id: string) => { await new Promise<void>(resolve => { finish = resolve }); disk.delete(id) })
    const pending = rollback(thread.id)
    await Promise.resolve()
    expect(disk.has(thread.id)).toBe(true)
    expect(useThreads.getState().threads[thread.id]).toBeDefined()
    useThreads.getState().setCurrentThreadId('another')
    finish(); await pending
    expect(disk.size).toBe(0)
    expect(Object.keys(useThreads.getState().threads)).toEqual(['prior'])
    expect(useThreads.getState().currentThreadId).toBe('another')
  })

  it('cleans up after a real rejected capability write replaces creation metadata', async () => {
    const thread = await create()
    await expect(useThreads.getState().setConversationCapabilities(thread.id, {})).rejects.toThrow('consent failed')
    useThreads.getState().setCurrentThreadId('another')
    await rollback(thread.id)
    expect(disk.size).toBe(0)
    expect(Object.keys(useThreads.getState().threads)).toEqual(['prior'])
    expect(useThreads.getState().currentThreadId).toBe('another')
  })

  it('tolerates capability-only overlays and passes the original creation receipt', async () => {
    const thread = await create()
    useThreads.getState().setThreads([{ ...thread, metadata: { conversationCapabilities: {} } }])
    await rollback(thread.id)
    expect(remove).toHaveBeenCalledWith(thread.id, thread)
    expect(disk.size).toBe(0)
    expect(useThreads.getState().threads).toEqual({})
  })

  it('reports successful disk deletion honestly if local work changes during delete', async () => {
    const thread = await create()
    remove.mockImplementationOnce(async (id: string) => {
      disk.delete(id)
      messages.set(id, [{ text: 'Concurrent local work' }])
    })
    await expect(rollback(thread.id)).rejects.toThrow('deleted from storage, but changed locally')
    expect(disk.size).toBe(0)
    expect(useThreads.getState().threads[thread.id]).toBeDefined()
  })

  it('does not restore a prior selection that no longer exists', async () => {
    const thread = await create()
    useThreads.setState({ threads: { [thread.id]: useThreads.getState().threads[thread.id] } })
    await rollback(thread.id)
    expect(useThreads.getState().currentThreadId).toBeUndefined()
  })

  it('retains disk, store and current selection when deletion fails', async () => {
    const thread = await create()
    remove.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(rollback(thread.id)).rejects.toThrow('disk unavailable')
    expect(disk.has(thread.id)).toBe(true)
    expect(useThreads.getState().threads[thread.id]).toBeDefined()
    expect(useThreads.getState().currentThreadId).toBe(thread.id)
    await rollback(thread.id)
    expect(disk.size).toBe(0)
    expect(Object.keys(useThreads.getState().threads)).toEqual(['prior'])
  })

  it.each(['changed', 'mutated', 'message', 'session'] as const)('refuses cleanup of %s records', async (change) => {
    const thread = await create()
    if (change === 'changed') useThreads.getState().updateThread(thread.id, { title: 'Edited' })
    if (change === 'mutated') useThreads.getState().threads[thread.id].title = 'Mutated'
    if (change === 'message') messages.set(thread.id, [{ text: 'Sent' }])
    if (change === 'session') sessions[thread.id] = {}
    await expect(rollback(thread.id)).rejects.toThrow('changed')
    expect(remove).not.toHaveBeenCalled()
    expect(disk.has(thread.id)).toBe(true)
    expect(useThreads.getState().threads[thread.id]).toBeDefined()
  })
  it('accepted creation releases rollback authority', async () => {
    const created = await create()
    useThreads.getState().acceptCreatedThread(created.id)
    await expect(rollback(created.id)).rejects.toThrow('refusing cleanup')
    expect(remove).not.toHaveBeenCalled()
    expect(disk.has(created.id)).toBe(true)
  })

})
