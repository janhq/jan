import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { logger } from '@janhq/core'
import DownloadManager, { Settings } from './index'

const mockInvoke = vi.mocked(invoke)
const mockListen = vi.mocked(listen)
const mockLoggerError = vi.mocked(logger.error)

function newManager(): DownloadManager {
  // BaseExtension constructor args (name, url, active...) are irrelevant to the mock.
  return new (DownloadManager as unknown as new () => DownloadManager)()
}

describe('DownloadManager', () => {
  let manager: DownloadManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockListen.mockResolvedValue(() => undefined as void)
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
    it('listens on the task-scoped channel and invokes download_files with items, taskId and headers', async () => {
      manager.hfToken = 'tok'
      mockInvoke.mockResolvedValueOnce(undefined)

      const items = [{ url: 'http://x/a.gguf', save_path: '/models/a.gguf' }]
      await manager.downloadFiles(items, 'task-1')

      expect(mockListen).toHaveBeenCalledWith(
        'download-task-1',
        expect.any(Function)
      )
      expect(mockInvoke).toHaveBeenCalledWith('download_files', {
        items,
        taskId: 'task-1',
        headers: { Authorization: 'Bearer tok' },
      })
    })

    it('relays tauri progress events into the onProgress callback', async () => {
      let captured: ((event: { payload: unknown }) => void) | undefined
      mockListen.mockImplementationOnce(async (_name, handler) => {
        captured = handler as typeof captured
        return () => undefined as void
      })
      mockInvoke.mockResolvedValueOnce(undefined)
      const onProgress = vi.fn()

      await manager.downloadFiles([], 'task-2', onProgress)

      captured?.({ payload: { transferred: 30, total: 100 } })
      expect(onProgress).toHaveBeenCalledWith(30, 100)
    })

    it('does not throw when a progress event arrives without a callback', async () => {
      let captured: ((event: { payload: unknown }) => void) | undefined
      mockListen.mockImplementationOnce(async (_name, handler) => {
        captured = handler as typeof captured
        return () => undefined as void
      })
      mockInvoke.mockResolvedValueOnce(undefined)

      await manager.downloadFiles([], 'task-3')

      expect(() =>
        captured?.({ payload: { transferred: 1, total: 2 } })
      ).not.toThrow()
    })

    it('unlistens after a successful download', async () => {
      const unlisten = vi.fn()
      mockListen.mockResolvedValueOnce(unlisten)
      mockInvoke.mockResolvedValueOnce(undefined)

      await manager.downloadFiles([], 'task-4')

      expect(unlisten).toHaveBeenCalledTimes(1)
    })

    it('logs, unlistens and rethrows when invoke fails', async () => {
      const unlisten = vi.fn()
      mockListen.mockResolvedValueOnce(unlisten)
      const err = new Error('network down')
      mockInvoke.mockRejectedValueOnce(err)

      await expect(manager.downloadFiles([], 'task-5')).rejects.toThrow(
        'network down'
      )
      expect(mockLoggerError).toHaveBeenCalled()
      expect(unlisten).toHaveBeenCalledTimes(1)
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
    it('invokes cancel_download_task with the taskId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await manager.cancelDownload('task-8')
      expect(mockInvoke).toHaveBeenCalledWith('cancel_download_task', {
        taskId: 'task-8',
      })
    })

    it('logs and rethrows on failure', async () => {
      const err = new Error('cancel failed')
      mockInvoke.mockRejectedValueOnce(err)
      await expect(manager.cancelDownload('task-8')).rejects.toThrow(
        'cancel failed'
      )
      expect(mockLoggerError).toHaveBeenCalled()
    })
  })

  describe('pauseDownload', () => {
    it('invokes pause_download_task with the taskId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await manager.pauseDownload('task-9')
      expect(mockInvoke).toHaveBeenCalledWith('pause_download_task', {
        taskId: 'task-9',
      })
    })

    it('logs and rethrows on failure', async () => {
      const err = new Error('pause failed')
      mockInvoke.mockRejectedValueOnce(err)
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
