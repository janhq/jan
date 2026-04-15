import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
  },
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue(mockStore),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.0.0'),
}))

import { check } from '@tauri-apps/plugin-updater'
import { invoke } from '@tauri-apps/api/core'
import { TauriUpdaterService } from '../tauri'
import { DefaultUpdaterService } from '../default'

// We need to reset the module-level cached nonce seed between tests
// by re-importing the module. Instead, we'll work around caching.

describe('TauriUpdaterService', () => {
  let svc: TauriUpdaterService

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(check).mockReset()
    mockStore.get.mockReset()
    mockStore.set.mockReset()
    mockStore.save.mockReset()
    // Default: store returns an existing nonce seed
    mockStore.get.mockResolvedValue('test-nonce-seed')
    svc = new TauriUpdaterService()
    // Reset module-level cache by reimporting - we use resetModules
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extends DefaultUpdaterService', () => {
    expect(svc).toBeInstanceOf(DefaultUpdaterService)
  })

  describe('check()', () => {
    it('returns update info from custom updater when available', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        version: '2.0.0',
        notes: 'Release notes',
        pub_date: '2026-01-01',
        signature: 'sig123',
      })
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await svc.check()

      expect(invoke).toHaveBeenCalledWith('check_for_app_updates', {
        nonceSeed: expect.any(String),
        currentVersion: expect.any(String),
      })
      expect(result).toEqual({
        version: '2.0.0',
        date: '2026-01-01',
        body: 'Release notes',
        signature: 'sig123',
      })
      spy.mockRestore()
    })

    it('falls back to standard Tauri updater when custom updater returns null', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null)
      const mockUpdate = {
        version: '1.5.0',
        date: '2026-02-01',
        body: 'Fallback notes',
      }
      vi.mocked(check).mockResolvedValueOnce(mockUpdate as any)

      const result = await svc.check()

      expect(result).toEqual({
        version: '1.5.0',
        date: '2026-02-01',
        body: 'Fallback notes',
      })
    })

    it('falls back to standard Tauri updater when custom updater throws', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('custom fail'))
      const mockUpdate = {
        version: '1.5.0',
        date: '2026-02-01',
        body: 'Fallback notes',
      }
      vi.mocked(check).mockResolvedValueOnce(mockUpdate as any)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await svc.check()

      expect(warnSpy).toHaveBeenCalled()
      expect(result).toEqual({
        version: '1.5.0',
        date: '2026-02-01',
        body: 'Fallback notes',
      })
      warnSpy.mockRestore()
    })

    it('returns null when no update is available from either source', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null)
      vi.mocked(check).mockResolvedValueOnce(null as any)

      const result = await svc.check()

      expect(result).toBeNull()
    })

    it('returns null and logs error when both updaters fail', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('custom fail'))
      vi.mocked(check).mockRejectedValueOnce(new Error('tauri fail'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await svc.check()

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(
        'Error checking for updates in Tauri:',
        expect.any(Error)
      )
      errorSpy.mockRestore()
    })
  })

  describe('installAndRestart()', () => {
    it('downloads and installs when update is available', async () => {
      const mockDownloadAndInstall = vi.fn().mockResolvedValue(undefined)
      vi.mocked(check).mockResolvedValueOnce({
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      } as any)

      await svc.installAndRestart()

      expect(check).toHaveBeenCalled()
      expect(mockDownloadAndInstall).toHaveBeenCalled()
    })

    it('does nothing when no update is available', async () => {
      vi.mocked(check).mockResolvedValueOnce(null as any)

      await svc.installAndRestart()

      expect(check).toHaveBeenCalled()
    })

    it('logs error and rethrows when check fails', async () => {
      const err = new Error('install fail')
      vi.mocked(check).mockRejectedValueOnce(err)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(svc.installAndRestart()).rejects.toBe(err)
      expect(errorSpy).toHaveBeenCalledWith(
        'Error installing update in Tauri:',
        err
      )
      errorSpy.mockRestore()
    })

    it('logs error and rethrows when downloadAndInstall fails', async () => {
      const err = new Error('download fail')
      vi.mocked(check).mockResolvedValueOnce({
        version: '2.0.0',
        downloadAndInstall: vi.fn().mockRejectedValue(err),
      } as any)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(svc.installAndRestart()).rejects.toBe(err)
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  describe('downloadAndInstallWithProgress()', () => {
    it('calls downloadAndInstall with progress callback', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation(async (cb) => {
        cb({ event: 'Started', data: { contentLength: 1000 } })
        cb({ event: 'Progress', data: { chunkLength: 500 } })
        cb({ event: 'Finished' })
      })
      vi.mocked(check).mockResolvedValueOnce({
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      } as any)

      const progressCb = vi.fn()
      await svc.downloadAndInstallWithProgress(progressCb)

      expect(mockDownloadAndInstall).toHaveBeenCalled()
      expect(progressCb).toHaveBeenCalledTimes(3)
      expect(progressCb).toHaveBeenCalledWith({ event: 'Started', data: { contentLength: 1000 } })
      expect(progressCb).toHaveBeenCalledWith({ event: 'Finished' })
    })

    it('throws when no update is available', async () => {
      vi.mocked(check).mockResolvedValueOnce(null as any)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(svc.downloadAndInstallWithProgress(vi.fn())).rejects.toThrow(
        'No update available'
      )
      errorSpy.mockRestore()
    })

    it('logs error and rethrows when download fails', async () => {
      const err = new Error('download error')
      vi.mocked(check).mockResolvedValueOnce({
        version: '2.0.0',
        downloadAndInstall: vi.fn().mockRejectedValue(err),
      } as any)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(svc.downloadAndInstallWithProgress(vi.fn())).rejects.toBe(err)
      expect(errorSpy).toHaveBeenCalledWith(
        'Error downloading update with progress in Tauri:',
        err
      )
      errorSpy.mockRestore()
    })

    it('handles errors in progress callback gracefully', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation(async (cb) => {
        cb({ event: 'Started' })
      })
      vi.mocked(check).mockResolvedValueOnce({
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      } as any)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const badCallback = vi.fn().mockImplementation(() => {
        throw new Error('callback error')
      })

      await svc.downloadAndInstallWithProgress(badCallback)

      expect(warnSpy).toHaveBeenCalledWith(
        'Error in download progress callback:',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })
  })
})
