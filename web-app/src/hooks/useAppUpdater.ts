import { isDev } from '@/lib/utils'
import { check, Update } from '@tauri-apps/plugin-updater'
import { useState, useCallback } from 'react'
import { events, AppEvent } from '@janhq/core'

export interface UpdateState {
  isUpdateAvailable: boolean
  updateInfo: Update | null
  isDownloading: boolean
  downloadProgress: number
  downloadedBytes: number
  totalBytes: number
  remindMeLater: boolean
}

export const useAppUpdater = () => {
  const [updateState, setUpdateState] = useState<UpdateState>({
    isUpdateAvailable: false,
    updateInfo: null,
    isDownloading: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    remindMeLater: false,
  })

  const checkForUpdate = useCallback(async (resetRemindMeLater = false) => {
    try {
      // Reset remindMeLater if requested (e.g., when called from settings)
      if (resetRemindMeLater) {
        setUpdateState((prev) => ({
          ...prev,
          remindMeLater: false,
        }))
      }

      if (!isDev()) {
        // Production mode - use actual Tauri updater
        const update = await check()

        if (update) {
          setUpdateState((prev) => ({
            ...prev,
            isUpdateAvailable: true,
            updateInfo: update,
          }))
          console.log('Update available:', update.version)
          return update
        } else {
          // No update available - reset state
          setUpdateState((prev) => ({
            ...prev,
            isUpdateAvailable: false,
            updateInfo: null,
          }))

          return null
        }
      } else {
        setUpdateState((prev) => ({
          ...prev,
          isUpdateAvailable: false,
          updateInfo: null,
        }))
        return null
      }
    } catch (error) {
      console.error('Error checking for updates:', error)
      // Reset state on error
      setUpdateState((prev) => ({
        ...prev,
        isUpdateAvailable: false,
        updateInfo: null,
      }))
      return null
    }
  }, [])

  const setRemindMeLater = useCallback((remind: boolean) => {
    setUpdateState((prev) => ({
      ...prev,
      remindMeLater: remind,
    }))
  }, [])

  const downloadAndInstallUpdate = useCallback(async () => {
    if (!updateState.updateInfo) return

    try {
      setUpdateState((prev) => ({
        ...prev,
        isDownloading: true,
      }))

      let downloaded = 0
      let contentLength = 0

      await updateState.updateInfo.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0
            setUpdateState((prev) => ({
              ...prev,
              totalBytes: contentLength,
            }))
            console.log(`Started downloading ${contentLength} bytes`)

            // Emit app update download started event
            events.emit(AppEvent.onAppUpdateDownloadUpdate, {
              progress: 0,
              downloadedBytes: 0,
              totalBytes: contentLength,
            })
            break
          case 'Progress': {
            downloaded += event.data.chunkLength
            const progress = contentLength > 0 ? downloaded / contentLength : 0
            setUpdateState((prev) => ({
              ...prev,
              downloadProgress: progress,
              downloadedBytes: downloaded,
            }))
            console.log(`Downloaded ${downloaded} from ${contentLength}`)

            // Emit app update download progress event
            events.emit(AppEvent.onAppUpdateDownloadUpdate, {
              progress: progress,
              downloadedBytes: downloaded,
              totalBytes: contentLength,
            })
            break
          }
          case 'Finished':
            console.log('Download finished')
            setUpdateState((prev) => ({
              ...prev,
              isDownloading: false,
              downloadProgress: 1,
            }))

            // Emit app update download success event
            events.emit(AppEvent.onAppUpdateDownloadSuccess, {})
            break
        }
      })

      await window.core?.api?.relaunch()

      console.log('Update installed')
    } catch (error) {
      console.error('Error downloading update:', error)
      setUpdateState((prev) => ({
        ...prev,
        isDownloading: false,
      }))

      // Emit app update download error event
      events.emit(AppEvent.onAppUpdateDownloadError, {
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [updateState.updateInfo])

  return {
    updateState,
    checkForUpdate,
    downloadAndInstallUpdate,
    setRemindMeLater,
  }
}
