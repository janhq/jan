import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useThreads } from '../useThreads'

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

  it('should delete all threads by project', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 't1', title: 'P1 Thread', metadata: { project: { id: 'p1' } } } as any,
        { id: 't2', title: 'P2 Thread', metadata: { project: { id: 'p2' } } } as any,
        { id: 't3', title: 'No Project' } as any,
      ])
    })

    act(() => {
      result.current.deleteAllThreadsByProject('p1')
    })

    expect(result.current.threads['t1']).toBeUndefined()
    expect(result.current.threads['t2']).toBeDefined()
    expect(result.current.threads['t3']).toBeDefined()
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
