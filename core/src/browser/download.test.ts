import { describe, it, expect, beforeEach, vi } from 'vitest'
import { downloads } from './download'

describe('downloads', () => {
  beforeEach(() => {
    globalThis.core = {
      api: {
        downloadFiles: vi.fn(),
        cancelDownloadTask: vi.fn(),
        pauseDownloadTask: vi.fn(),
        onDownloadProgress: vi.fn(),
      },
    }
  })

  it('passes items, taskId and headers through to downloadFiles', async () => {
    const items = [{ url: 'http://x/a.gguf', save_path: '/models/a.gguf' }]
    const headers = { Authorization: 'Bearer tok' }
    await downloads.downloadFiles(items, 'task-1', headers)
    expect(globalThis.core.api.downloadFiles).toHaveBeenCalledWith({
      items,
      taskId: 'task-1',
      headers,
    })
  })

  it('propagates a downloadFiles rejection', async () => {
    globalThis.core.api.downloadFiles.mockRejectedValue(new Error('boom'))
    await expect(downloads.downloadFiles([], 'task-1', {})).rejects.toThrow('boom')
  })

  it('passes the taskId through to cancelDownloadTask', async () => {
    await downloads.cancelDownload('task-2')
    expect(globalThis.core.api.cancelDownloadTask).toHaveBeenCalledWith({ taskId: 'task-2' })
  })

  it('passes the taskId through to pauseDownloadTask', async () => {
    await downloads.pauseDownload('task-3')
    expect(globalThis.core.api.pauseDownloadTask).toHaveBeenCalledWith({ taskId: 'task-3' })
  })

  it('subscribes to progress for a task and returns the unsubscribe function', async () => {
    const unsubscribe = vi.fn()
    globalThis.core.api.onDownloadProgress.mockResolvedValue(unsubscribe)
    const handler = vi.fn()

    const result = await downloads.onDownloadProgress('task-4', handler)

    expect(globalThis.core.api.onDownloadProgress).toHaveBeenCalledWith('task-4', handler)
    expect(result).toBe(unsubscribe)
  })

  // Without a host (e.g. tests or a non-desktop shell) callers still always
  // receive a callable unsubscribe, so their finally blocks never throw.
  it('returns a no-op unsubscribe when the host has no progress subscription', async () => {
    globalThis.core = { api: {} }
    const result = await downloads.onDownloadProgress('task-5', vi.fn())
    expect(() => result()).not.toThrow()
  })
})
