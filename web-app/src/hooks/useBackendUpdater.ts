import { useState, useCallback, useEffect } from 'react'
import { events } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'

export interface BackendUpdateInfo {
  updateNeeded: boolean
  newVersion: string
  currentVersion?: string
}

interface ExtensionSetting {
  key: string
  controllerProps?: {
    value: unknown
  }
}

interface LlamacppExtension {
  getSettings?(): Promise<ExtensionSetting[]>
  checkBackendForUpdates?(): Promise<BackendUpdateInfo>
  updateBackend?(
    targetBackend: string
  ): Promise<{ wasUpdated: boolean; newBackend: string }>
  installBackend?(filePath: string): Promise<void>
  configureBackends?(): Promise<void>
}

export interface BackendUpdateState {
  isUpdateAvailable: boolean
  updateInfo: BackendUpdateInfo | null
  isUpdating: boolean
  remindMeLater: boolean
  autoUpdateEnabled: boolean
}

export const useBackendUpdater = () => {
  const [updateState, setUpdateState] = useState<BackendUpdateState>({
    isUpdateAvailable: false,
    updateInfo: null,
    isUpdating: false,
    remindMeLater: false,
    autoUpdateEnabled: false,
  })

  // Listen for backend update state sync events
  useEffect(() => {
    const handleUpdateStateSync = (newState: Partial<BackendUpdateState>) => {
      setUpdateState((prev) => ({
        ...prev,
        ...newState,
      }))
    }

    events.on('onBackendUpdateStateSync', handleUpdateStateSync)

    return () => {
      events.off('onBackendUpdateStateSync', handleUpdateStateSync)
    }
  }, [])

  // Check auto update setting from llamacpp extension
  useEffect(() => {
    const checkAutoUpdateSetting = async () => {
      try {
        // Get llamacpp extension instance
        const allExtensions = ExtensionManager.getInstance().listExtensions()
        let llamacppExtension =
          ExtensionManager.getInstance().getByName('llamacpp-extension')

        if (!llamacppExtension) {
          // Try to find by type or other properties
          llamacppExtension =
            allExtensions.find(
              (ext) =>
                ext.constructor.name.toLowerCase().includes('llamacpp') ||
                (ext.type &&
                  ext.type()?.toString().toLowerCase().includes('inference'))
            ) || undefined
        }

        if (llamacppExtension && 'getSettings' in llamacppExtension) {
          const extension = llamacppExtension as LlamacppExtension
          const settings = await extension.getSettings?.()
          const autoUpdateSetting = settings?.find(
            (s) => s.key === 'auto_update_engine'
          )

          setUpdateState((prev) => ({
            ...prev,
            autoUpdateEnabled:
              autoUpdateSetting?.controllerProps?.value === true,
          }))
        }
      } catch (error) {
        console.error('Failed to check auto update setting:', error)
      }
    }

    checkAutoUpdateSetting()
  }, [])

  const syncStateToOtherInstances = useCallback(
    (partialState: Partial<BackendUpdateState>) => {
      // Emit event to sync state across all useBackendUpdater instances
      events.emit('onBackendUpdateStateSync', partialState)
    },
    []
  )

  const checkForUpdate = useCallback(
    async (resetRemindMeLater = false) => {
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
          syncStateToOtherInstances(newState)
        }

        // Get llamacpp extension instance
        const allExtensions = ExtensionManager.getInstance().listExtensions()

        const llamacppExtension =
          ExtensionManager.getInstance().getByName('llamacpp-extension')

        let extensionToUse = llamacppExtension

        if (!llamacppExtension) {
          // Try to find by type or other properties
          const possibleExtension = allExtensions.find(
            (ext) =>
              ext.constructor.name.toLowerCase().includes('llamacpp') ||
              (ext.type &&
                ext.type()?.toString().toLowerCase().includes('inference'))
          )

          if (!possibleExtension) {
            console.error('LlamaCpp extension not found')
            return null
          }

          extensionToUse = possibleExtension
        }

        if (!extensionToUse || !('checkBackendForUpdates' in extensionToUse)) {
          console.error(
            'Extension does not support checkBackendForUpdates method'
          )
          return null
        }

        // Call the extension's checkBackendForUpdates method
        const extension = extensionToUse as LlamacppExtension
        const updateInfo = await extension.checkBackendForUpdates?.()

        if (updateInfo?.updateNeeded) {
          const newState = {
            isUpdateAvailable: true,
            remindMeLater: false,
            updateInfo,
          }
          setUpdateState((prev) => ({
            ...prev,
            ...newState,
          }))
          syncStateToOtherInstances(newState)
          console.log('Backend update available:', updateInfo?.newVersion)
          return updateInfo
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
          syncStateToOtherInstances(newState)
          return null
        }
      } catch (error) {
        console.error('Error checking for backend updates:', error)
        // Reset state on error
        const newState = {
          isUpdateAvailable: false,
          updateInfo: null,
        }
        setUpdateState((prev) => ({
          ...prev,
          ...newState,
        }))
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
      syncStateToOtherInstances(newState)
    },
    [syncStateToOtherInstances]
  )

  const updateBackend = useCallback(async () => {
    if (!updateState.updateInfo) return

    try {
      setUpdateState((prev) => ({
        ...prev,
        isUpdating: true,
      }))

      // Get llamacpp extension instance
      const allExtensions = ExtensionManager.getInstance().listExtensions()
      const llamacppExtension =
        ExtensionManager.getInstance().getByName('llamacpp-extension')

      let extensionToUse = llamacppExtension

      if (!llamacppExtension) {
        // Try to find by type or other properties
        const possibleExtension = allExtensions.find(
          (ext) =>
            ext.constructor.name.toLowerCase().includes('llamacpp') ||
            (ext.type &&
              ext.type()?.toString().toLowerCase().includes('inference'))
        )

        if (!possibleExtension) {
          throw new Error('LlamaCpp extension not found')
        }

        extensionToUse = possibleExtension
      }

      if (
        !extensionToUse ||
        !('getSettings' in extensionToUse) ||
        !('updateBackend' in extensionToUse)
      ) {
        throw new Error('Extension does not support backend updates')
      }

      // Get current backend version to construct target backend string
      const extension = extensionToUse as LlamacppExtension
      const settings = await extension.getSettings?.()
      const currentBackendSetting = settings?.find(
        (s) => s.key === 'version_backend'
      )
      const currentBackend = currentBackendSetting?.controllerProps
        ?.value as string

      if (!currentBackend) {
        throw new Error('Current backend not found')
      }

      // Extract backend type from current backend string (e.g., "b3224/cuda12" -> "cuda12")
      const [, backendType] = currentBackend.split('/')
      const targetBackendString = `${updateState.updateInfo.newVersion}/${backendType}`

      // Call the extension's updateBackend method
      const result = await extension.updateBackend?.(targetBackendString)

      if (result?.wasUpdated) {
        // Reset update state
        const newState = {
          isUpdateAvailable: false,
          updateInfo: null,
          isUpdating: false,
        }
        setUpdateState((prev) => ({
          ...prev,
          ...newState,
        }))
        syncStateToOtherInstances(newState)
      } else {
        throw new Error('Backend update failed')
      }
    } catch (error) {
      console.error('Error updating backend:', error)
      setUpdateState((prev) => ({
        ...prev,
        isUpdating: false,
      }))
      throw error
    }
  }, [updateState.updateInfo, syncStateToOtherInstances])

  const installBackend = useCallback(async (filePath: string) => {
    try {
      // Get llamacpp extension instance
      const allExtensions = ExtensionManager.getInstance().listExtensions()
      const llamacppExtension =
        ExtensionManager.getInstance().getByName('llamacpp-extension')

      let extensionToUse = llamacppExtension

      if (!llamacppExtension) {
        // Try to find by type or other properties
        const possibleExtension = allExtensions.find(
          (ext) =>
            ext.constructor.name.toLowerCase().includes('llamacpp') ||
            (ext.type &&
              ext.type()?.toString().toLowerCase().includes('inference'))
        )

        if (!possibleExtension) {
          throw new Error('LlamaCpp extension not found')
        }

        extensionToUse = possibleExtension
      }

      if (!extensionToUse || !('installBackend' in extensionToUse)) {
        throw new Error('Extension does not support backend installation')
      }

      // Call the extension's installBackend method
      const extension = extensionToUse as LlamacppExtension
      await extension.installBackend?.(filePath)

      // Refresh backend list to update UI
      await extension.configureBackends?.()
    } catch (error) {
      console.error('Error installing backend:', error)
      throw error
    }
  }, [])

  return {
    updateState,
    checkForUpdate,
    updateBackend,
    setRemindMeLater,
    installBackend,
  }
}
