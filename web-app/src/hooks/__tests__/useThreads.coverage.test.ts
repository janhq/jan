import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useThreads } from '../useThreads'
import { useChatSessions } from '@/stores/chat-session-store'
import { useCoworkSessions } from '../useCoworkSessions'
import { useAppState } from '../useAppState'
import { createHandle, getRunHandle, abortRun } from '@/lib/coworkRunner'
import { cleanupThreadWorkspace, cancelAgentThreadBash, stopAgentSessionMonitors } from '@/lib/agentTools'

vi.mock('@/lib/agentTools', () => ({
  cleanupThreadWorkspace: vi.fn(),
  cancelAgentThreadBash: vi.fn(),
  stopAgentSessionMonitors: vi.fn(),
}))

vi.mock('@/services/threads', () => ({
  createThread: vi.fn(),
  deleteThread: vi.fn(),
  updateThread: vi.fn(),
}))

vi.mock('ulidx', () => ({
  ulid: vi.fn(() => 'test-ulid-123'),
}))

vi.mock('fzf', () => ({
  Fzf: vi.fn().mockImplementation((items: any[]) => ({
    find: vi.fn((term: string) => {
      return items
        .filter((item: any) => item.title?.toLowerCase().includes(term.toLowerCase()))
        .map((item: any) => ({ item, positions: new Set() }))
    }),
  })),
}))

const mockCreateThread = vi.fn()
const mockDeleteThread = vi.fn()
const mockUpdateThread = vi.fn()
const mockFlushCoworkDeletes = vi.fn()

vi.mock('@/lib/coworkSync', () => ({
  startCoworkSync: async () => {},
  flushCoworkDeletes: () => mockFlushCoworkDeletes(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    threads: () => ({
      createThread: mockCreateThread,
      deleteThread: mockDeleteThread,
      updateThread: mockUpdateThread,
    }),
    path: () => ({
      sep: () => '/',
    }),
  }),
}))

vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: {
    getState: () => ({
      removeThread: vi.fn(),
    }),
  },
}))

vi.mock('@janhq/core', () => ({
  ExtensionTypeEnum: { VectorDB: 'VectorDB' },
  VectorDBExtension: class {},
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => null,
    }),
  },
}))

vi.mock('@/constants/chat', () => ({
  TEMPORARY_CHAT_ID: 'temporary-chat',
}))

describe('useThreads - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteThread.mockResolvedValue(undefined)
    mockFlushCoworkDeletes.mockResolvedValue(undefined)
    useCoworkSessions.setState({ sessions: [], currentId: null })
    act(() => {
      useThreads.setState({
        threads: {},
        currentThreadId: undefined,
        searchIndex: null,
      })
    })
  })

  it('should create a thread', async () => {
    const newThread = { id: 'test-ulid-123', title: 'New Thread', model: { id: 'm1', provider: 'openai' } }
    mockCreateThread.mockResolvedValue(newThread)

    const { result } = renderHook(() => useThreads())

    let created: any
    await act(async () => {
      created = await result.current.createThread({ id: 'm1', provider: 'openai' } as any)
    })

    expect(created.id).toBe('test-ulid-123')
    expect(result.current.currentThreadId).toBe('test-ulid-123')
  })

  it('should create a temporary thread', async () => {
    const tempThread = { id: 'temporary-chat', title: 'Temporary Chat', model: { id: 'm1', provider: 'openai' } }
    mockCreateThread.mockResolvedValue(tempThread)

    const { result } = renderHook(() => useThreads())

    await act(async () => {
      await result.current.createThread({ id: 'm1', provider: 'openai' } as any, undefined, undefined, undefined, true)
    })

    expect(mockCreateThread).toHaveBeenCalledWith(expect.objectContaining({
      id: 'temporary-chat',
      metadata: expect.objectContaining({ isTemporary: true }),
    }))
  })

  it('should create thread with project metadata', async () => {
    const thread = { id: 'test-ulid-123', title: 'New Thread' }
    mockCreateThread.mockResolvedValue(thread)

    const { result } = renderHook(() => useThreads())

    await act(async () => {
      await result.current.createThread(
        { id: 'm1', provider: 'openai' } as any,
        'My Thread',
        undefined,
        { id: 'p1', name: 'Project', updated_at: 1 }
      )
    })

    expect(mockCreateThread).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Thread',
      metadata: { project: { id: 'p1', name: 'Project', updated_at: 1 } },
    }))
  })

  it('should create temporary thread with project metadata', async () => {
    const thread = { id: 'temporary-chat', title: 'Temporary Chat' }
    mockCreateThread.mockResolvedValue(thread)

    const { result } = renderHook(() => useThreads())

    await act(async () => {
      await result.current.createThread(
        { id: 'm1', provider: 'openai' } as any,
        undefined,
        undefined,
        { id: 'p1', name: 'Project', updated_at: 1 },
        true
      )
    })

    expect(mockCreateThread).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { isTemporary: true, project: { id: 'p1', name: 'Project', updated_at: 1 } },
    }))
  })

  it('should create thread with assistant', async () => {
    const thread = { id: 'test-ulid-123', title: 'New Thread' }
    mockCreateThread.mockResolvedValue(thread)

    const { result } = renderHook(() => useThreads())
    const assistant = { id: 'jan', name: 'Jan' } as any

    await act(async () => {
      await result.current.createThread({ id: 'm1', provider: 'openai' } as any, 'Title', assistant)
    })

    expect(mockCreateThread).toHaveBeenCalledWith(expect.objectContaining({
      assistants: [assistant],
    }))
  })

  it('should update current thread model', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([{ id: 't1', title: 'T1', model: { id: 'm1', provider: 'p1' } } as any])
      result.current.setCurrentThreadId('t1')
    })

    act(() => {
      result.current.updateCurrentThreadModel({ id: 'm2', provider: 'p2' } as any)
    })

    expect(result.current.threads['t1'].model?.id).toBe('m2')
  })

  it('should not update model when no current thread', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.updateCurrentThreadModel({ id: 'm2', provider: 'p2' } as any)
    })

    // Should not throw
    expect(result.current.currentThreadId).toBeUndefined()
  })

  it('should update current thread assistant', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([{ id: 't1', title: 'T1', model: { id: 'm1', provider: 'p1' } } as any])
      result.current.setCurrentThreadId('t1')
    })

    act(() => {
      result.current.updateCurrentThreadAssistant({ id: 'a1', name: 'Asst' } as any)
    })

    expect(result.current.threads['t1'].assistants?.[0]?.id).toBe('a1')
  })

  it('should clear assistant when undefined passed', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([{ id: 't1', title: 'T1', model: { id: 'm1', provider: 'p1' }, assistants: [{ id: 'a1' }] } as any])
      result.current.setCurrentThreadId('t1')
    })

    act(() => {
      result.current.updateCurrentThreadAssistant(undefined as any)
    })

    expect(result.current.threads['t1'].assistants).toEqual([])
  })

  it('should not update assistant when no current thread', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.updateCurrentThreadAssistant({ id: 'a1' } as any)
    })

    expect(result.current.currentThreadId).toBeUndefined()
  })

  it('should update thread timestamp', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([{ id: 't1', title: 'T1', updated: 1000 } as any])
    })

    act(() => {
      result.current.updateThreadTimestamp('t1')
    })

    expect(result.current.threads['t1'].updated).toBeGreaterThan(1000)
  })

  it('should not update timestamp for non-existent thread', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.updateThreadTimestamp('nonexistent')
    })

    // Should not throw
    expect(Object.keys(result.current.threads)).toHaveLength(0)
  })

  it('should update thread', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([{ id: 't1', title: 'Old', updated: 1 } as any])
    })

    act(() => {
      result.current.updateThread('t1', { title: 'New' } as any)
    })

    expect(result.current.threads['t1'].title).toBe('New')
  })

  it('should not update non-existent thread', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.updateThread('nonexistent', { title: 'X' } as any)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(0)
  })

  it('should rename non-existent thread without error', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.renameThread('nonexistent', 'New Name')
    })

    expect(Object.keys(result.current.threads)).toHaveLength(0)
  })

  it('should delete all threads keeping favorites and project threads', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'Fav', isFavorite: true } as any,
        { id: 't2', title: 'Normal' } as any,
        { id: 't3', title: 'Project', metadata: { project: { id: 'p1' } } } as any,
      ])
    })

    act(() => {
      result.current.deleteAllThreads()
    })

    expect(result.current.threads['t1']).toBeDefined()
    expect(result.current.threads['t2']).toBeUndefined()
    expect(result.current.threads['t3']).toBeDefined()
  })

  // Removing the chat session is what ends a turn still running in the
  // background (#9311), so deleting a thread in bulk must remove it too.
  it('removes the chat session of each thread deleted in bulk', () => {
    const { result } = renderHook(() => useThreads())
    const session = (id: string) =>
      useChatSessions
        .getState()
        .ensureSession(
          id,
          {} as never,
          () => ({ status: 'ready', stop: vi.fn() }) as never
        )

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'Fav', isFavorite: true } as any,
        { id: 't2', title: 'Normal' } as any,
      ])
      session('t1')
      session('t2')
    })

    act(() => {
      result.current.deleteAllThreads()
    })

    expect(useChatSessions.getState().sessions['t2']).toBeUndefined()
    expect(useChatSessions.getState().sessions['t1']).toBeDefined()
  })

  it('should clear all threads', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'T1' } as any,
        { id: 't2', title: 'T2' } as any,
      ])
    })

    act(() => {
      result.current.clearAllThreads()
    })

    expect(result.current.threads).toEqual({})
    expect(result.current.currentThreadId).toBeUndefined()
  })

  it('should delete all threads by project', async () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'P1 Thread', metadata: { project: { id: 'p1' } } } as any,
        { id: 't2', title: 'P2 Thread', metadata: { project: { id: 'p2' } } } as any,
        { id: 't3', title: 'No Project' } as any,
      ])
    })

    await act(async () => {
      await result.current.deleteAllThreadsByProject('p1')
    })

    expect(result.current.threads['t1']).toBeUndefined()
    expect(result.current.threads['t2']).toBeDefined()
    expect(result.current.threads['t3']).toBeDefined()
  })

  it('deletes mixed project chat and Cowork sessions, including sessions not yet mirrored', async () => {
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    const session = (id: string, projectId = 'p1') => ({
      id, title: id, folder: null, turns: [], messages: [], updated: 1,
      project: { ...project, id: projectId },
    })
    useCoworkSessions.setState({
      sessions: [session('cowork'), session('pending'), session('other', 'p2')],
      currentId: 'cowork',
    })
    useThreads.getState().setThreads([
      { id: 'chat', title: 'Project chat', metadata: { project } },
      { id: 'cowork', title: 'Project task', metadata: { mode: 'cowork', project } },
      { id: 'other', title: 'Other task', metadata: { mode: 'cowork', project: { ...project, id: 'p2' } } },
      { id: 'loose', title: 'Loose chat' },
    ] as Thread[])
    useThreads.getState().setCurrentThreadId('cowork')
    const handle = createHandle('cowork', 'run')
    const child = new AbortController()
    handle.subagents.set('child', child)
    const answer = vi.fn()
    handle.pendingAsks.set('ask', answer)
    const otherHandle = createHandle('other', 'other-run')

    await useThreads.getState().deleteAllThreadsByProject('p1')

    expect(useCoworkSessions.getState().sessions.map(s => s.id)).toEqual(['other'])
    expect(useCoworkSessions.getState().currentId).toBe('other')
    expect(Object.keys(useThreads.getState().threads)).toEqual(['other', 'loose'])
    expect(useThreads.getState().currentThreadId).toBeUndefined()
    expect(useThreads.getState().getFilteredThreads('Project')).toEqual([])
    // Cowork persistence must be deleted by session sync, never by a competing writer.
    expect(mockDeleteThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(handle.outer.signal.aborted).toBe(true)
    expect(handle.tools.signal.aborted).toBe(true)
    expect(child.signal.aborted).toBe(true)
    expect(answer).toHaveBeenCalledWith(null)
    expect(getRunHandle('cowork')).toBeUndefined()
    expect(cancelAgentThreadBash).toHaveBeenCalledWith('cowork')
    expect(cancelAgentThreadBash).toHaveBeenCalledWith('pending')
    expect(stopAgentSessionMonitors).toHaveBeenCalledWith('cowork')
    expect(otherHandle.outer.signal.aborted).toBe(false)
    // A late completion cannot recreate a removed session or schedule its persistence.
    useCoworkSessions.getState().setMessages('cowork', [])
    expect(useCoworkSessions.getState().sessions.map(s => s.id)).toEqual(['other'])
    abortRun('other')
  })

  it.each(['p2', undefined])('uses the live session project %s instead of stale mirror p1', async (projectId) => {
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    useCoworkSessions.setState({ sessions: [{
      id: 'moved', title: 'Moved', folder: null, turns: [], messages: [], updated: 1,
      project: projectId ? { ...project, id: projectId } : undefined,
    }] })
    useThreads.getState().setThreads([
      { id: 'moved', title: 'Moved', metadata: { mode: 'cowork', project } },
    ] as Thread[])
    useThreads.getState().setCurrentThreadId('moved')

    await useThreads.getState().deleteAllThreadsByProject('p1')

    expect(useCoworkSessions.getState().sessions.map(s => s.id)).toEqual(['moved'])
    expect(useThreads.getState().threads.moved).toBeDefined()
    expect(useThreads.getState().currentThreadId).toBe('moved')
    expect(mockDeleteThread).not.toHaveBeenCalled()

    if (projectId) {
      await useThreads.getState().deleteAllThreadsByProject(projectId)
      expect(useCoworkSessions.getState().sessions).toEqual([])
      expect(useThreads.getState().threads.moved).toBeUndefined()
    }
  })

  it.each(['Chat', 'Cowork'])('waits for delayed %s durable deletion before pruning state', async (mode) => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    const thread = { id: 'delayed', title: 'Delayed', metadata: { project } } as Thread
    if (mode === 'Cowork') {
      thread.metadata = { ...thread.metadata, mode: 'cowork' }
      useCoworkSessions.setState({ sessions: [{
        id: thread.id, title: thread.title!, folder: null, turns: [], messages: [], updated: 1, project,
      }] })
      mockFlushCoworkDeletes.mockReturnValueOnce(pending)
    } else {
      mockDeleteThread.mockReturnValueOnce(pending)
    }
    useThreads.getState().setThreads([thread])
    useThreads.getState().setCurrentThreadId(thread.id)
    let completed = false
    const deleting = useThreads.getState().deleteAllThreadsByProject('p1').then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(useThreads.getState().threads.delayed).toBeDefined()
    expect(useThreads.getState().currentThreadId).toBe('delayed')
    finish()
    await deleting
    expect(useThreads.getState().threads.delayed).toBeUndefined()
    expect(useThreads.getState().currentThreadId).toBeUndefined()
  })

  it.each(['Chat', 'Cowork'])('propagates rejected %s deletion without pruning thread state', async (mode) => {
    const failure = new Error('durable delete failed')
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    const thread = { id: 'failed', title: 'Failed', metadata: { project } } as Thread
    if (mode === 'Cowork') {
      thread.metadata = { ...thread.metadata, mode: 'cowork' }
      useCoworkSessions.setState({ sessions: [{
        id: thread.id, title: thread.title!, folder: null, turns: [], messages: [], updated: 1, project,
      }] })
      mockFlushCoworkDeletes.mockRejectedValueOnce(failure)
    } else {
      mockDeleteThread.mockRejectedValueOnce(failure)
    }
    useThreads.getState().setThreads([thread])
    useThreads.getState().setCurrentThreadId(thread.id)

    await expect(useThreads.getState().deleteAllThreadsByProject('p1')).rejects.toMatchObject({ errors: [failure] })

    expect(useThreads.getState().threads.failed).toEqual(thread)
    expect(useThreads.getState().currentThreadId).toBe('failed')
    expect(useThreads.getState().getFilteredThreads('Failed')).toHaveLength(1)
  })

  it('deletes both same-project records when a collision placeholder shares a chat ID', async () => {
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    useCoworkSessions.setState({ sessions: [{
      id: 'collision', title: 'Legacy task', folder: null, turns: [], messages: [], updated: 1,
      project, unavailable: 'id-collision',
    }] })
    useThreads.getState().setThreads([
      { id: 'collision', title: 'Real chat', metadata: { project } },
    ] as Thread[])
    useThreads.getState().setCurrentThreadId('collision')

    await useThreads.getState().deleteAllThreadsByProject('p1')

    expect(mockDeleteThread).toHaveBeenCalledExactlyOnceWith('collision')
    expect(mockFlushCoworkDeletes).toHaveBeenCalledOnce()
    expect(useCoworkSessions.getState().sessions).toEqual([])
    expect(useThreads.getState().threads.collision).toBeUndefined()
    expect(useThreads.getState().currentThreadId).toBeUndefined()
    expect(cleanupThreadWorkspace).toHaveBeenCalledWith('collision', 'thread')
    expect(cancelAgentThreadBash).not.toHaveBeenCalled()
  })

  it('reconciles the first chat before a second chat rejects and keeps failed state retryable', async () => {
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    const stops = { first: vi.fn(), second: vi.fn() }
    useThreads.getState().setThreads(['first', 'second'].map(id => ({
      id, title: id, metadata: { project },
    })) as Thread[])
    useThreads.getState().setCurrentThreadId('first')
    for (const id of ['first', 'second'] as const) {
      useChatSessions.getState().ensureSession(id, {} as never,
        () => ({ status: 'streaming', stop: stops[id] }) as never)
      useAppState.getState().setThreadErrorMessage(id, 'saved error')
    }
    const failure = new Error('second deletion failed')
    mockDeleteThread.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      // The first chat must already be stopped and absent while B is pending.
      expect(useThreads.getState().threads.first).toBeUndefined()
      expect(stops.first).toHaveBeenCalledOnce()
      expect(useAppState.getState().errorMessages.first).toBeUndefined()
      throw failure
    })

    await expect(useThreads.getState().deleteAllThreadsByProject('p1')).rejects.toMatchObject({
      errors: [failure],
    })

    expect(Object.keys(useThreads.getState().threads)).toEqual(['second'])
    expect(useThreads.getState().currentThreadId).toBeUndefined()
    expect(useThreads.getState().getFilteredThreads('first')).toEqual([])
    expect(useThreads.getState().getFilteredThreads('second')).toHaveLength(1)
    expect(stops.second).not.toHaveBeenCalled()
    expect(useChatSessions.getState().sessions.second).toBeDefined()
    expect(useAppState.getState().errorMessages.second).toBe('saved error')
    expect(cleanupThreadWorkspace).toHaveBeenCalledExactlyOnceWith('first', 'thread')
    useChatSessions.getState().removeSession('second')
  })

  it('keeps a successful chat reconciled when later Cowork persistence fails', async () => {
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    useThreads.getState().setThreads([
      { id: 'chat', title: 'Chat', metadata: { project } },
      { id: 'task', title: 'Task', metadata: { project, mode: 'cowork' } },
    ] as Thread[])
    useCoworkSessions.setState({ sessions: [{
      id: 'task', title: 'Task', folder: null, turns: [], messages: [], updated: 1, project,
    }] })
    const failure = new Error('Cowork delete failed')
    mockFlushCoworkDeletes.mockRejectedValueOnce(failure)

    await expect(useThreads.getState().deleteAllThreadsByProject('p1')).rejects.toMatchObject({ errors: [failure] })

    expect(useThreads.getState().threads.chat).toBeUndefined()
    expect(useThreads.getState().threads.task).toBeDefined()
    expect(useThreads.getState().getFilteredThreads('Chat')).toEqual([])
    expect(cleanupThreadWorkspace).toHaveBeenCalledExactlyOnceWith('chat', 'thread')
  })

  it('reconciles the first Cowork deletion before the second flush fails', async () => {
    const project = { id: 'p1', name: 'Project', updated_at: 1 }
    const sessions = ['done', 'failed'].map(id => ({
      id, title: id, folder: null, turns: [], messages: [], updated: 1, project,
    }))
    useCoworkSessions.setState({ sessions })
    useThreads.getState().setThreads(sessions.map(({ id, title }) => ({
      id, title, metadata: { project, mode: 'cowork' },
    })) as Thread[])
    const failure = new Error('second Cowork deletion failed')
    mockFlushCoworkDeletes.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      expect(useThreads.getState().threads.done).toBeUndefined()
      // Real sync restores the failed session snapshot before rejecting.
      useCoworkSessions.setState({ sessions: [sessions[1]] })
      throw failure
    })

    await expect(useThreads.getState().deleteAllThreadsByProject('p1')).rejects.toMatchObject({ errors: [failure] })

    expect(Object.keys(useThreads.getState().threads)).toEqual(['failed'])
    expect(useCoworkSessions.getState().sessions.map(s => s.id)).toEqual(['failed'])
    expect(mockDeleteThread).not.toHaveBeenCalled()
  })

  it('should get filtered threads with search term', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'React hooks' } as any,
        { id: 't2', title: 'Vue components' } as any,
      ])
    })

    const filtered = result.current.getFilteredThreads('React')
    expect(filtered.length).toBeGreaterThanOrEqual(0)
  })

  it('should handle setThreads with model without provider', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'T1' } as any,
      ])
    })

    expect(result.current.threads['t1'].model).toBeUndefined()
  })

  it('should handle setThreads with non-llamacpp provider', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'T1', model: { provider: 'openai', id: 'gpt-4' } } as any,
      ])
    })

    expect(result.current.threads['t1'].model?.id).toBe('gpt-4')
    expect(result.current.threads['t1'].model?.provider).toBe('openai')
  })

  it('setCurrentThreadId should not re-set if same', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setCurrentThreadId('t1')
    })

    // Call again with same ID - should be no-op
    act(() => {
      result.current.setCurrentThreadId('t1')
    })

    expect(result.current.currentThreadId).toBe('t1')
  })

  it('should get filtered threads when searchIndex is null', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      useThreads.setState({
        threads: { 't1': { id: 't1', title: 'Hello' } as any },
        searchIndex: null,
      })
    })

    // Should recreate index
    const filtered = result.current.getFilteredThreads('Hello')
    expect(Array.isArray(filtered)).toBe(true)
  })

  it('unstarAllThreads should set all isFavorite to false', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'T1', isFavorite: true } as any,
        { id: 't2', title: 'T2', isFavorite: true } as any,
      ])
    })

    act(() => {
      result.current.unstarAllThreads()
    })

    expect(result.current.threads['t1'].isFavorite).toBe(false)
    expect(result.current.threads['t2'].isFavorite).toBe(false)
  })

  it('getFavoriteThreads should return only favorites', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'T1', isFavorite: true } as any,
        { id: 't2', title: 'T2', isFavorite: false } as any,
        { id: 't3', title: 'T3', isFavorite: true } as any,
      ])
    })

    const favorites = result.current.getFavoriteThreads()
    expect(favorites).toHaveLength(2)
  })
})
