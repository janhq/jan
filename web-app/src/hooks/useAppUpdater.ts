import { isDev } from '@/lib/utils'
import { useState, useCallback, useEffect } from 'react'
import { events, AppEvent } from '@janhq/core'
import type { UpdateInfo } from '@/services/updater/types'
import { SystemEvent } from '@/types/events'
import { getServiceHub } from '@/hooks/useServiceHub'

export interface UpdateState {
  isUpdateAvailable: boolean
  updateInfo: UpdateInfo | null
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

  // Listen for app update state sync events
  useEffect(() => {
    const handleUpdateStateSync = (newState: Partial<UpdateState>) => {
      setUpdateState((prev) => ({
        ...prev,
        ...newState,
      }))
    }

    events.on('onAppUpdateStateSync', handleUpdateStateSync)

    return () => {
      events.off('onAppUpdateStateSync', handleUpdateStateSync)
    }
  }, [])

  const syncStateToOtherInstances = useCallback(
    (partialState: Partial<UpdateState>) => {
      // Emit event to sync state across all useAppUpdater instances
      events.emit('onAppUpdateStateSync', partialState)
    },
    []
  )

  const checkForUpdate = useCallback(
    async (resetRemindMeLater = false) => {
      if (AUTO_UPDATER_DISABLED) {
        console.log('Auto updater is disabled')
        return
      }

      console.log('Checking for updates...')

      try {
        // Reset remindMeLater if requested (e.g., when called from settings)
        if (resetRemindMeLater) {
          const newState = {
            remindMeLater: false,
          }
          setUpdateState((prev) => ({
            ...prev,
            ...newState,
          }))
          // Sync to other instances
          syncStateToOtherInstances(newState)
        }

        if (!isDev()) {
          // Production mode - use actual Tauri updater
          const update = await getServiceHub().updater().check()

          if (update) {
            const newState = {
              isUpdateAvailable: true,
              remindMeLater: false,
              updateInfo: update,
            }
            setUpdateState((prev) => ({
              ...prev,
              ...newState,
            }))
            // Sync to other instances
            syncStateToOtherInstances(newState)
            console.log('Update available:', update.version)
            return update
          } else {
            // No update available - reset state
            const newState = {
              isUpdateAvailable: false,
              updateInfo: null,
            }
            setUpdateState((prev) => ({
              ...prev,
              ...newState,
            }))
            // Sync to other instances
            syncStateToOtherInstances(newState)
            return null
          }
        } else {
          const newState = {
            isUpdateAvailable: false,
            updateInfo: null,
            ...(resetRemindMeLater && { remindMeLater: false }),
          }
          setUpdateState((prev) => ({
            ...prev,
            ...newState,
          }))
          // Sync to other instances
          syncStateToOtherInstances(newState)
          return null
        }
      } catch (error) {
        console.error('Error checking for updates:', error)
        // Reset state on error
        const newState = {
          isUpdateAvailable: false,
          updateInfo: null,
        }
        setUpdateState((prev) => ({
          ...prev,
          ...newState,
        }))
        // Sync to other instances
        syncStateToOtherInstances(newState)
        return null
      }
    },
    [syncStateToOtherInstances]
  )

  const setRemindMeLater = useCallback(
    (remind: boolean) => {
      const newState = {
        remindMeLater: remind,
      }
      setUpdateState((prev) => ({
        ...prev,
        ...newState,
      }))
      // Sync to other instances
      syncStateToOtherInstances(newState)
    },
    [syncStateToOtherInstances]
  )

  const downloadAndInstallUpdate = useCallback(async () => {
    if (AUTO_UPDATER_DISABLED) {
      console.log('Auto updater is disabled')
      return
    }

    if (!updateState.updateInfo) return

    try {
      setUpdateState((prev) => ({
        ...prev,
        isDownloading: true,
      }))

      let downloaded = 0
      let contentLength = 0
      await getServiceHub().models().stopAllModels()
      getServiceHub().events().emit(SystemEvent.KILL_SIDECAR)
      await new Promise((resolve) => setTimeout(resolve, 1000))

      await getServiceHub().updater().downloadAndInstallWithProgress((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data?.contentLength || 0
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
            downloaded += event.data?.chunkLength || 0
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
