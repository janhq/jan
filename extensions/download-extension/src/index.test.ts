import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloads, logger } from '@janhq/core'
import DownloadManager, { Settings } from './index'

const mockDownloadFiles = vi.mocked(downloads.downloadFiles)
const mockCancel = vi.mocked(downloads.cancelDownload)
const mockPause = vi.mocked(downloads.pauseDownload)
const mockOnProgress = vi.mocked(downloads.onDownloadProgress)
const mockLoggerError = vi.mocked(logger.error)

function newManager(): DownloadManager {
  // BaseExtension constructor args (name, url, active...) are irrelevant to the mock.
  return new (DownloadManager as unknown as new () => DownloadManager)()
}

describe('DownloadManager', () => {
  let manager: DownloadManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnProgress.mockResolvedValue(() => undefined)
    manager = newManager()
  })

  describe('onLoad', () => {
    it('registers settings and hydrates hfToken from persisted setting', async () => {
      ;(manager.getSetting as any).mockResolvedValueOnce('secret-token')

      await manager.onLoad()

      expect(manager.registerSettings).toHaveBeenCalledWith(SETTINGS)
      expect(manager.getSetting).toHaveBeenCalledWith(Settings.hfToken, undefined)
      expect(manager.hfToken).toBe('secret-token')
    })
  })

  describe('onSettingUpdate', () => {
    it('updates hfToken when the hf-token key changes', () => {
      manager.onSettingUpdate(Settings.hfToken, 'new-token')
      expect(manager.hfToken).toBe('new-token')
    })

    it('ignores unrelated setting keys', () => {
      manager.hfToken = 'keep'
      manager.onSettingUpdate('some-other-key', 'value')
      expect(manager.hfToken).toBe('keep')
    })
  })

  describe('_getHeaders', () => {
    it('returns empty headers when no token is set', () => {
      manager.hfToken = undefined
      expect(manager._getHeaders()).toEqual({})
    })

    it('returns a bearer Authorization header when a token is set', () => {
      manager.hfToken = 'abc123'
      expect(manager._getHeaders()).toEqual({
        Authorization: 'Bearer abc123',
      })
    })
  })

  describe('downloadFiles', () => {
    it('subscribes to the task progress and downloads with items, taskId and headers', async () => {
      manager.hfToken = 'tok'
      mockDownloadFiles.mockResolvedValueOnce(undefined)

      const items = [{ url: 'http://x/a.gguf', save_path: '/models/a.gguf' }]
      await manager.downloadFiles(items, 'task-1')

      expect(mockOnProgress).toHaveBeenCalledWith('task-1', expect.any(Function))
      expect(mockDownloadFiles).toHaveBeenCalledWith(items, 'task-1', {
        Authorization: 'Bearer tok',
      })
    })

    it('relays progress events into the onProgress callback', async () => {
      let captured: ((progress: { transferred: number; total: number }) => void) | undefined
      mockOnProgress.mockImplementationOnce(async (_taskId, handler) => {
        captured = handler
        return () => undefined
      })
      mockDownloadFiles.mockResolvedValueOnce(undefined)
      const onProgress = vi.fn()

      await manager.downloadFiles([], 'task-2', onProgress)

      captured?.({ transferred: 30, total: 100 })
      expect(onProgress).toHaveBeenCalledWith(30, 100)
    })

    it('does not throw when a progress event arrives without a callback', async () => {
      let captured: ((progress: { transferred: number; total: number }) => void) | undefined
      mockOnProgress.mockImplementationOnce(async (_taskId, handler) => {
        captured = handler
        return () => undefined
      })
      mockDownloadFiles.mockResolvedValueOnce(undefined)

      await manager.downloadFiles([], 'task-3')

      expect(() => captured?.({ transferred: 1, total: 2 })).not.toThrow()
    })

    it('unsubscribes after a successful download', async () => {
      const unsubscribe = vi.fn()
      mockOnProgress.mockResolvedValueOnce(unsubscribe)
      mockDownloadFiles.mockResolvedValueOnce(undefined)

      await manager.downloadFiles([], 'task-4')

      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('logs, unsubscribes and rethrows when the download fails', async () => {
      const unsubscribe = vi.fn()
      mockOnProgress.mockResolvedValueOnce(unsubscribe)
      const err = new Error('network down')
      mockDownloadFiles.mockRejectedValueOnce(err)

      await expect(manager.downloadFiles([], 'task-5')).rejects.toThrow(
        'network down'
      )
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error downloading task',
        'task-5',
        err
      )
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })
  })

  describe('downloadFile', () => {
    it('wraps a single item with proxy config and delegates to downloadFiles', async () => {
      const spy = vi
        .spyOn(manager, 'downloadFiles')
        .mockResolvedValueOnce(undefined)
      const onProgress = vi.fn()
      const proxy = { https: 'http://proxy:8080' }

      await manager.downloadFile(
        'http://x/b.gguf',
        '/models/b.gguf',
        'task-6',
        proxy,
        onProgress
      )

      expect(spy).toHaveBeenCalledWith(
        [{ url: 'http://x/b.gguf', save_path: '/models/b.gguf', proxy }],
        'task-6',
        onProgress
      )
    })

    it('defaults proxy config to an empty object', async () => {
      const spy = vi
        .spyOn(manager, 'downloadFiles')
        .mockResolvedValueOnce(undefined)

      await manager.downloadFile('http://x/c.gguf', '/models/c.gguf', 'task-7')

      expect(spy).toHaveBeenCalledWith(
        [{ url: 'http://x/c.gguf', save_path: '/models/c.gguf', proxy: {} }],
        'task-7',
        undefined
      )
    })
  })

  describe('cancelDownload', () => {
    it('cancels the task through the core download API', async () => {
      mockCancel.mockResolvedValueOnce(undefined)
      await manager.cancelDownload('task-8')
      expect(mockCancel).toHaveBeenCalledWith('task-8')
    })

    it('logs and rethrows on failure', async () => {
      const err = new Error('cancel failed')
      mockCancel.mockRejectedValueOnce(err)
      await expect(manager.cancelDownload('task-8')).rejects.toThrow(
        'cancel failed'
      )
      expect(mockLoggerError).toHaveBeenCalled()
    })
  })

  describe('pauseDownload', () => {
    it('pauses the task through the core download API', async () => {
      mockPause.mockResolvedValueOnce(undefined)
      await manager.pauseDownload('task-9')
      expect(mockPause).toHaveBeenCalledWith('task-9')
    })

    it('logs and rethrows on failure', async () => {
      const err = new Error('pause failed')
      mockPause.mockRejectedValueOnce(err)
      await expect(manager.pauseDownload('task-9')).rejects.toThrow(
        'pause failed'
      )
      expect(mockLoggerError).toHaveBeenCalled()
    })
  })

  describe('onUnload', () => {
    it('resolves without error', async () => {
      await expect(manager.onUnload()).resolves.toBeUndefined()
    })
  })
})
