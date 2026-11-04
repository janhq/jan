import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@/lib/platform', () => ({ isPlatformTauri: () => true }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: h.invoke }),
    events: () => ({ listen: h.listen }),
  }),
}))

import { APIs } from '../service'

type DownloadApis = {
  downloadFiles: (args: Record<string, unknown>) => Promise<void>
  cancelDownloadTask: (args: Record<string, unknown>) => Promise<void>
  pauseDownloadTask: (args: Record<string, unknown>) => Promise<void>
  onDownloadProgress: (
    taskId: string,
    handler: (progress: { transferred: number; total: number }) => void
  ) => Promise<() => void>
}

const api = APIs as unknown as DownloadApis

describe('download routes', () => {
  beforeEach(() => {
    h.invoke.mockReset().mockResolvedValue(undefined)
    h.listen.mockReset()
  })

  it.each([
    ['downloadFiles', 'download_files'],
    ['cancelDownloadTask', 'cancel_download_task'],
    ['pauseDownloadTask', 'pause_download_task'],
  ] as const)('maps %s to the %s command', async (route, command) => {
    const args = { taskId: 'task-1' }
    await api[route](args)
    expect(h.invoke).toHaveBeenCalledWith(command, args)
  })

  it('subscribes to the task channel and relays the raw payload', async () => {
    const unlisten = vi.fn()
    let relay: ((event: { payload: unknown }) => void) | undefined
    h.listen.mockImplementation(async (_event, handler) => {
      relay = handler
      return unlisten
    })
    const handler = vi.fn()

    const unsubscribe = await api.onDownloadProgress('task-2', handler)

    expect(h.listen).toHaveBeenCalledWith('download-task-2', expect.any(Function))
    relay?.({ payload: { transferred: 5, total: 10 } })
    expect(handler).toHaveBeenCalledWith({ transferred: 5, total: 10 })
    expect(unsubscribe).toBe(unlisten)
  })
})
