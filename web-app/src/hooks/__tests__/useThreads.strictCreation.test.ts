import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DefaultThreadsService } from '@/services/threads/default'
import { useThreads } from '../useThreads'

// Only the native backend route is faked: the store calls the actual default
// service through the service hub, including its strict rejection behavior.
const boundary = vi.hoisted(() => ({
  service: undefined as DefaultThreadsService | undefined,
  available: true,
  createThread: vi.fn(),
  invoke: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    threads: () => boundary.service!,
    path: () => ({ sep: () => '/' }),
    core: () => ({ invoke: boundary.invoke }),
  }),
}))
vi.mock('@janhq/core', () => ({
  VectorDBExtension: class {},
}))
vi.mock('@/hooks/useMessages', () => ({ useMessages: { getState: () => ({ getMessages: () => [] }) } }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => ({ sessions: {} }) } }))
vi.mock('@/lib/agentTools', () => ({ cleanupThreadWorkspace: vi.fn(), cancelAgentThreadBash: vi.fn(), stopAgentSessionMonitors: vi.fn() }))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: {} }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: {} }))
vi.mock('@/hooks/useCoworkSessions', () => ({ useCoworkSessions: {} }))
vi.mock('@/hooks/useCoworkRun', () => ({ useCoworkRun: {} }))
vi.mock('@/lib/coworkRunner', () => ({ abortRun: vi.fn() }))
vi.mock('@/lib/coworkMonitor', () => ({ dropMonitorLane: vi.fn() }))

describe('strict store creation with real DefaultThreadsService', () => {
  const originalCore = window.core
  afterEach(() => {
    window.core = originalCore
  })

  beforeEach(() => {
    vi.clearAllMocks()
    boundary.service = new DefaultThreadsService()
    boundary.available = true
    // The service reaches the backend route directly on window.core.api.
    Object.defineProperty(window, 'core', {
      configurable: true,
      writable: true,
      value: {
        get api() {
          return boundary.available ? { createThread: boundary.createThread } : {}
        },
      },
    })
    useThreads.getState().setThreads([{ id: 'prior', title: 'Prior', updated: 1 }])
    useThreads.getState().setCurrentThreadId('prior')
  })

  it.each([
    ['unavailable extension', 'Chat persistence unavailable'],
    ['native create rejection', 'native create failed'],
    ['invalid native response', 'Invalid persisted chat response'],
  ])('rejects %s without inserting or selecting a phantom across retries', async (failure, message) => {
    boundary.available = failure !== 'unavailable extension'
    if (failure === 'native create rejection') {
      boundary.createThread.mockRejectedValue(new Error('native create failed'))
    } else {
      boundary.createThread.mockResolvedValue({ id: 'wrong-id', assistants: [], updated: 1 })
    }
    const before = useThreads.getState()
    const changed = vi.fn()
    const unsubscribe = useThreads.subscribe(changed)
    try {
      for (let retry = 0; retry < 3; retry++) {
        await expect(useThreads.getState().createThread(
          { id: 'test-model', provider: 'test' },
          'Unpersisted draft', undefined, undefined, false, { strict: true }
        )).rejects.toThrow(message)
        expect(useThreads.getState().threads).toBe(before.threads)
        expect(useThreads.getState().currentThreadId).toBe('prior')
        expect(useThreads.getState().searchIndex).toBe(before.searchIndex)
        expect(Object.keys(useThreads.getState().threads)).toEqual(['prior'])
        expect(useThreads.getState().getFilteredThreads('Unpersisted')).toEqual([])
      }
      expect(changed).not.toHaveBeenCalled()
      expect(boundary.createThread).toHaveBeenCalledTimes(boundary.available ? 3 : 0)
      expect(boundary.invoke).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })
})
