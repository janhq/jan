import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  fetchThreads: vi.fn(),
  setThreads: vi.fn(),
  existing: {} as Record<string, unknown>,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ threads: () => ({ fetchThreads: h.fetchThreads }) }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({ setThreads: h.setThreads, threads: h.existing }),
  },
}))

import { refreshThreadsFromBackend } from '../refreshThreads'

describe('refreshThreadsFromBackend', () => {
  beforeEach(() => {
    h.fetchThreads.mockReset()
    h.setThreads.mockReset()
    h.existing = {}
  })

  it('replaces the store with the freshly listed threads', async () => {
    h.fetchThreads.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await refreshThreadsFromBackend()
    expect(h.setThreads).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }])
  })

  it('never wipes a populated list with an empty result', async () => {
    h.existing = { a: {} }
    h.fetchThreads.mockResolvedValue([])
    await refreshThreadsFromBackend()
    expect(h.setThreads).not.toHaveBeenCalled()
  })

  it('lets a fetch failure propagate to its caller', async () => {
    h.fetchThreads.mockRejectedValue(new Error('not ready'))
    await expect(refreshThreadsFromBackend()).rejects.toThrow('not ready')
  })
})
