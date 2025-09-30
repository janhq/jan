import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAppUpdater, UpdateState } from '../useAppUpdater'

// Mock dependencies
vi.mock('@/lib/utils', () => ({
  isDev: vi.fn(() => false),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@janhq/core', () => ({
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  AppEvent: {
    onAppUpdateDownloadUpdate: 'onAppUpdateDownloadUpdate',
    onAppUpdateDownloadSuccess: 'onAppUpdateDownloadSuccess',
    onAppUpdateDownloadError: 'onAppUpdateDownloadError',
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
}))

vi.mock('@/types/events', () => ({
  SystemEvent: {
    KILL_SIDECAR: 'KILL_SIDECAR',
  },
}))

// Mock the ServiceHub
const mockStopAllModels = vi.fn()
const mockUpdaterCheck = vi.fn()
const mockUpdaterDownloadAndInstall = vi.fn()
const mockUpdaterDownloadAndInstallWithProgress = vi.fn()
const mockEventsEmit = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    models: () => ({
      stopAllModels: mockStopAllModels,
    }),
    updater: () => ({
      check: mockUpdaterCheck,
      downloadAndInstall: mockUpdaterDownloadAndInstall,
      downloadAndInstallWithProgress: mockUpdaterDownloadAndInstallWithProgress,
    }),
    events: () => ({
      emit: mockEventsEmit,
    }),
  }),
}))

// Mock global window.core
Object.defineProperty(window, 'core', {
  value: {
    api: {
      relaunch: vi.fn(),
    },
  },
  writable: true,
})

// Mock global AUTO_UPDATER_DISABLED
Object.defineProperty(global, 'AUTO_UPDATER_DISABLED', {
  value: false,
  writable: true,
})

import { isDev } from '@/lib/utils'
import { check } from '@tauri-apps/plugin-updater'
import { events } from '@janhq/core'
import { emit } from '@tauri-apps/api/event'

describe('useAppUpdater', () => {
  const mockEvents = events as any
  const mockIsDev = isDev as any
  const mockEmit = emit as any
  const mockRelaunch = window.core?.api?.relaunch as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDev.mockReturnValue(false)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAppUpdater())

    expect(result.current.updateState).toEqual({
      isUpdateAvailable: false,
      updateInfo: null,
      isDownloading: false,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      remindMeLater: false,
    })
  })

  it('should set up event listeners for update state sync', () => {
    renderHook(() => useAppUpdater())

    expect(mockEvents.on).toHaveBeenCalledWith(
      'onAppUpdateStateSync',
      expect.any(Function)
    )
  })

  it('should clean up event listeners on unmount', () => {
    const { unmount } = renderHook(() => useAppUpdater())

    unmount()

    expect(mockEvents.off).toHaveBeenCalledWith(
      'onAppUpdateStateSync',
      expect.any(Function)
    )
  })

  it('should handle app update state sync events', () => {
    const { result } = renderHook(() => useAppUpdater())

    // Get the handler function that was registered
    const syncHandler = mockEvents.on.mock.calls[0][1]

    act(() => {
      syncHandler({ isUpdateAvailable: true, remindMeLater: true })
    })

    expect(result.current.updateState.isUpdateAvailable).toBe(true)
    expect(result.current.updateState.remindMeLater).toBe(true)
  })

  describe('checkForUpdate', () => {
    it('should check for updates and find an available update', async () => {
      const mockUpdate = {
        version: '1.2.0',
        downloadAndInstall: vi.fn(),
      }
      mockUpdaterCheck.mockResolvedValue(mockUpdate)

      const { result } = renderHook(() => useAppUpdater())

      let updateResult: any
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(mockUpdaterCheck).toHaveBeenCalled()
      expect(result.current.updateState.isUpdateAvailable).toBe(true)
      expect(result.current.updateState.updateInfo).toBe(mockUpdate)
      expect(result.current.updateState.remindMeLater).toBe(false)
      expect(updateResult).toBe(mockUpdate)
    })

    it('should handle no update available', async () => {
      mockUpdaterCheck.mockResolvedValue(null)

      const { result } = renderHook(() => useAppUpdater())

      let updateResult: any
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(result.current.updateState.isUpdateAvailable).toBe(false)
      expect(result.current.updateState.updateInfo).toBe(null)
      expect(updateResult).toBe(null)
    })

    it('should handle errors during update check', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockUpdaterCheck.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useAppUpdater())

      let updateResult: any
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error checking for updates:',
        expect.any(Error)
      )
      expect(result.current.updateState.isUpdateAvailable).toBe(false)
      expect(result.current.updateState.updateInfo).toBe(null)
      expect(updateResult).toBe(null)

      consoleErrorSpy.mockRestore()
    })

    it('should reset remindMeLater when requested', async () => {
      mockUpdaterCheck.mockResolvedValue(null)

      const { result } = renderHook(() => useAppUpdater())

      // Set remindMeLater to true first
      act(() => {
        result.current.setRemindMeLater(true)
      })

      expect(result.current.updateState.remindMeLater).toBe(true)

      await act(async () => {
        await result.current.checkForUpdate(true)
      })

      expect(result.current.updateState.remindMeLater).toBe(false)
    })

    it('should skip update check in dev mode', async () => {
      mockIsDev.mockReturnValue(true)

      const { result } = renderHook(() => useAppUpdater())

      let updateResult: any
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(mockUpdaterCheck).not.toHaveBeenCalled()
      expect(result.current.updateState.isUpdateAvailable).toBe(false)
      expect(updateResult).toBe(null)
    })
  })

  describe('setRemindMeLater', () => {
    it('should set remind me later state', () => {
      const { result } = renderHook(() => useAppUpdater())

      act(() => {
        result.current.setRemindMeLater(true)
      })

      expect(result.current.updateState.remindMeLater).toBe(true)

      act(() => {
        result.current.setRemindMeLater(false)
      })

      expect(result.current.updateState.remindMeLater).toBe(false)
    })

    it('should sync remind me later state to other instances', () => {
      const { result } = renderHook(() => useAppUpdater())

      act(() => {
        result.current.setRemindMeLater(true)
      })

      expect(mockEvents.emit).toHaveBeenCalledWith('onAppUpdateStateSync', {
        remindMeLater: true,
      })
    })
  })

  describe('downloadAndInstallUpdate', () => {
    it('should download and install update successfully', async () => {
      const mockDownloadAndInstall = vi.fn()
      const mockUpdate = {
        version: '1.2.0',
        downloadAndInstall: mockDownloadAndInstall,
      }

      // Mock check to return the update
      mockUpdaterCheck.mockResolvedValue(mockUpdate)

      const { result } = renderHook(() => useAppUpdater())

      // Set update info first by calling checkForUpdate
      await act(async () => {
        await result.current.checkForUpdate()
      })

      // Mock the download and install process
      mockUpdaterDownloadAndInstallWithProgress.mockImplementation(async (progressCallback) => {
        // Simulate download events
        progressCallback({
          event: 'Started',
          data: { contentLength: 1000 },
        })
        progressCallback({
          event: 'Progress',
          data: { chunkLength: 500 },
        })
        progressCallback({
          event: 'Progress',
          data: { chunkLength: 500 },
        })
        progressCallback({
          event: 'Finished',
        })
      })

      await act(async () => {
        await result.current.downloadAndInstallUpdate()
      })

      expect(mockStopAllModels).toHaveBeenCalled()
      expect(mockEventsEmit).toHaveBeenCalledWith('KILL_SIDECAR')
      expect(mockUpdaterDownloadAndInstallWithProgress).toHaveBeenCalled()
      expect(mockRelaunch).toHaveBeenCalled()
    })

    it('should handle download errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockDownloadAndInstall = vi.fn()
      const mockUpdate = {
        version: '1.2.0',
        downloadAndInstall: mockDownloadAndInstall,
      }

      // Mock check to return the update
      mockUpdaterCheck.mockResolvedValue(mockUpdate)

      const { result } = renderHook(() => useAppUpdater())

      // Set update info first by calling checkForUpdate
      await act(async () => {
        await result.current.checkForUpdate()
      })

      mockUpdaterDownloadAndInstallWithProgress.mockRejectedValue(new Error('Download failed'))

      await act(async () => {
        await result.current.downloadAndInstallUpdate()
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error downloading update:',
        expect.any(Error)
      )
      expect(result.current.updateState.isDownloading).toBe(false)
      expect(mockEvents.emit).toHaveBeenCalledWith('onAppUpdateDownloadError', {
        message: 'Download failed',
      })

      consoleErrorSpy.mockRestore()
    })

    it('should not download if no update info is available', async () => {
      const { result } = renderHook(() => useAppUpdater())

      await act(async () => {
        await result.current.downloadAndInstallUpdate()
      })

      expect(mockStopAllModels).not.toHaveBeenCalled()
    })

    it('should emit progress events during download', async () => {
      const mockDownloadAndInstall = vi.fn()
      const mockUpdate = {
        version: '1.2.0',
        downloadAndInstall: mockDownloadAndInstall,
      }

      // Mock check to return the update
      mockUpdaterCheck.mockResolvedValue(mockUpdate)

      const { result } = renderHook(() => useAppUpdater())

      // Set update info first by calling checkForUpdate
      await act(async () => {
        await result.current.checkForUpdate()
      })

      mockUpdaterDownloadAndInstallWithProgress.mockImplementation(async (progressCallback) => {
        progressCallback({
          event: 'Started',
          data: { contentLength: 2000 },
        })
        progressCallback({
          event: 'Progress',
          data: { chunkLength: 1000 },
        })
        progressCallback({
          event: 'Finished',
        })
      })

      await act(async () => {
        await result.current.downloadAndInstallUpdate()
      })

      expect(mockEvents.emit).toHaveBeenCalledWith('onAppUpdateDownloadUpdate', {
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 2000,
      })
      expect(mockEvents.emit).toHaveBeenCalledWith('onAppUpdateDownloadUpdate', {
        progress: 0.5,
        downloadedBytes: 1000,
        totalBytes: 2000,
      })
      expect(mockEvents.emit).toHaveBeenCalledWith('onAppUpdateDownloadSuccess', {})
    })
  })
})
