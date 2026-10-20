import { beforeEach, expect, it, vi } from 'vitest'
import { useThreads } from '../useThreads'

const mock = vi.hoisted(() => ({
  deleteThread: vi.fn(), session: vi.fn(), mode: vi.fn(), state: vi.fn(),
  workspace: vi.fn(), vectors: vi.fn(), cache: vi.fn(), stop: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ threads: () => ({ deleteThread: mock.deleteThread }) }) }))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: { getState: () => ({ removeThread: mock.mode }) } }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => ({ removeSession: mock.session, sessions: {} }) } }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: { getState: () => ({ clearThreadState: mock.state }) } }))
vi.mock('@/lib/agentTools', () => ({ cleanupThreadWorkspace: mock.workspace }))
vi.mock('@/lib/extension', () => ({ ExtensionManager: { getInstance: () => ({ get: () => ({ deleteCollection: mock.vectors }) }) } }))
vi.mock('@janhq/core', () => ({ ExtensionTypeEnum: { VectorDB: 'vector' }, EngineManager: { instance: () => ({ get: () => ({ forgetThreadCache: mock.cache }) }) } }))

beforeEach(() => {
  vi.clearAllMocks()
  useThreads.setState({ threads: {
    a: { id: 'a', title: 'Keep until deleted', updated: 1 },
    b: { id: 'b', title: 'Second chat', updated: 1 },
    favorite: { id: 'favorite', title: 'Favorite', updated: 1, isFavorite: true },
  }, searchIndex: null })
})

it('retains state and artifacts while backend deletion is pending', async () => {
  let resolve!: () => void
  mock.deleteThread.mockReturnValue(new Promise<void>(r => { resolve = r }))
  const pending = useThreads.getState().deleteThread('a')
  expect(useThreads.getState().threads.a).toBeDefined()
  expect(mock.session).not.toHaveBeenCalled()
  expect(mock.workspace).not.toHaveBeenCalled()
  expect(mock.vectors).not.toHaveBeenCalled()
  resolve()
  await pending
  expect(useThreads.getState().threads.a).toBeUndefined()
  expect(mock.session).toHaveBeenCalledWith('a')
})

it('propagates backend failure and preserves recoverable conversation state', async () => {
  mock.deleteThread.mockRejectedValue(new Error('disk denied'))
  await expect(useThreads.getState().deleteThread('a')).rejects.toThrow('disk denied')
  expect(useThreads.getState().threads.a).toBeDefined()
  expect(mock.session).not.toHaveBeenCalled()
  expect(mock.mode).not.toHaveBeenCalled()
  expect(mock.state).not.toHaveBeenCalled()
  expect(mock.workspace).not.toHaveBeenCalled()
})

it('bulk deletion removes successes, preserves failures and favorites, and rejects', async () => {
  mock.deleteThread.mockImplementation((id: string) => id === 'a' ? Promise.reject(new Error('disk denied')) : Promise.resolve())
  await expect(useThreads.getState().deleteAllThreads()).rejects.toThrow('disk denied')
  expect(Object.keys(useThreads.getState().threads).sort()).toEqual(['a', 'favorite'])
  expect(mock.session).toHaveBeenCalledTimes(1)
  expect(mock.session).toHaveBeenCalledWith('b')
  expect(mock.deleteThread).not.toHaveBeenCalledWith('favorite')
})

it('project deletion keeps unrelated threads and retries only remaining failures', async () => {
  useThreads.setState({ threads: {
    a: { id: 'a', title: 'Failed', updated: 1, metadata: { project: { id: 'p', name: 'Project', updated_at: 1 } } },
    b: { id: 'b', title: 'Deleted', updated: 1, metadata: { project: { id: 'p', name: 'Project', updated_at: 1 } } },
    other: { id: 'other', title: 'Outside project', updated: 1 },
  }, currentThreadId: 'a' })
  mock.deleteThread.mockImplementation((id: string) => id === 'a' ? Promise.reject(new Error('locked')) : Promise.resolve())
  await expect(useThreads.getState().deleteAllThreadsByProject('p')).rejects.toThrow('locked')
  expect(Object.keys(useThreads.getState().threads).sort()).toEqual(['a', 'other'])
  expect(useThreads.getState().currentThreadId).toBe('a')
  mock.deleteThread.mockClear().mockResolvedValue(undefined)
  await useThreads.getState().deleteAllThreadsByProject('p')
  expect(mock.deleteThread).toHaveBeenCalledExactlyOnceWith('a')
  expect(useThreads.getState().currentThreadId).toBeUndefined()
  expect(useThreads.getState().threads.other).toBeDefined()
})

it('clear all retains failed favorites rather than discarding all state', async () => {
  mock.deleteThread.mockImplementation((id: string) => id === 'favorite' ? Promise.reject(new Error('locked')) : Promise.resolve())
  await expect(useThreads.getState().clearAllThreads()).rejects.toThrow('locked')
  expect(Object.keys(useThreads.getState().threads)).toEqual(['favorite'])
})

it('stops generation before deleting storage without removing its session on failure', async () => {
  const { useChatSessions } = await import('@/stores/chat-session-store')
  const stop = vi.fn().mockResolvedValue(undefined)
  const getState = vi.spyOn(useChatSessions, 'getState').mockReturnValue({
    sessions: { a: { chat: { stop } } }, removeSession: mock.session,
  } as unknown as ReturnType<typeof useChatSessions.getState>)
  mock.deleteThread.mockImplementation(() => {
    expect(stop).toHaveBeenCalledOnce()
    return Promise.reject(new Error('locked'))
  })
  await expect(useThreads.getState().deleteThread('a')).rejects.toThrow('locked')
  expect(useThreads.getState().threads.a).toBeDefined()
  expect(mock.session).not.toHaveBeenCalled()
  getState.mockRestore()
})
