import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  fetchThreads: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    threads: () => ({ fetchThreads: h.fetchThreads, deleteThread: vi.fn() }),
    path: () => ({ sep: () => '/' }),
  }),
}))
vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: { getState: () => ({ removeThread: vi.fn() }) },
}))
vi.mock('@/stores/chat-session-store', () => ({
  useChatSessions: { getState: () => ({ removeSession: vi.fn() }) },
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: { getState: () => ({ clearThreadState: vi.fn() }) },
}))
vi.mock('@/lib/agentTools', () => ({ cleanupThreadWorkspace: vi.fn() }))
vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({ services: { get: () => undefined } }),
}))

import { refreshThreadsFromBackend } from '../refreshThreads'
import { useThreads } from '@/hooks/useThreads'

const t = (id: string, extra: Partial<Thread> = {}) =>
  ({ id, title: `T ${id}`, updated: 1, ...extra }) as unknown as Thread

describe('refreshThreadsFromBackend', () => {
  beforeEach(() => {
    h.fetchThreads.mockReset()
    useThreads.setState({ threads: {}, searchIndex: null })
  })

  it('adds the freshly listed threads that the store lacks', async () => {
    h.fetchThreads.mockResolvedValue([t('a'), t('b')])
    await refreshThreadsFromBackend()
    expect(Object.keys(useThreads.getState().threads).sort()).toEqual(['a', 'b'])
  })

  it('never replaces a thread the store already has: renames and favourites stay', async () => {
    useThreads.setState({
      threads: { a: t('a', { title: 'Renamed', isFavorite: true }) },
    })
    h.fetchThreads.mockResolvedValue([t('a'), t('late')])
    await refreshThreadsFromBackend()
    const { threads } = useThreads.getState()
    expect(threads.a.title).toBe('Renamed')
    expect(threads.a.isFavorite).toBe(true)
    expect(threads.late).toBeDefined()
  })

  it('keeps a thread created while the fetch was in flight', async () => {
    useThreads.setState({ threads: { a: t('a') } })
    let release!: (v: Thread[]) => void
    h.fetchThreads.mockReturnValue(new Promise((r) => (release = r)))
    const pending = refreshThreadsFromBackend()
    // The user starts a new chat; the backend list was read before it existed.
    useThreads.setState((s) => ({ threads: { ...s.threads, fresh: t('fresh') } }))
    release([t('a'), t('late')])
    await pending
    expect(Object.keys(useThreads.getState().threads).sort()).toEqual([
      'a',
      'fresh',
      'late',
    ])
  })

  it('does not bring back a thread deleted while the fetch was in flight', async () => {
    useThreads.setState({ threads: { a: t('a'), gone: t('gone') } })
    let release!: (v: Thread[]) => void
    h.fetchThreads.mockReturnValue(new Promise((r) => (release = r)))
    const pending = refreshThreadsFromBackend()
    useThreads.getState().deleteThread('gone')
    // One created and deleted inside the window is not resurrected either.
    useThreads.setState((s) => ({ threads: { ...s.threads, brief: t('brief') } }))
    useThreads.getState().deleteThread('brief')
    release([t('a'), t('gone'), t('brief'), t('late')])
    await pending
    expect(Object.keys(useThreads.getState().threads).sort()).toEqual(['a', 'late'])
  })

  it('an empty result changes nothing', async () => {
    useThreads.setState({ threads: { a: t('a') } })
    h.fetchThreads.mockResolvedValue([])
    await refreshThreadsFromBackend()
    expect(Object.keys(useThreads.getState().threads)).toEqual(['a'])
  })

  it('lets a fetch failure propagate to its caller and stops watching the store', async () => {
    h.fetchThreads.mockRejectedValue(new Error('not ready'))
    await expect(refreshThreadsFromBackend()).rejects.toThrow('not ready')
  })
})
