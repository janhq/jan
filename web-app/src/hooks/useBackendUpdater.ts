import { useState, useCallback, useEffect } from 'react'
import { events } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'

export interface BackendUpdateInfo {
  updateNeeded: boolean
  newVersion: string
  currentVersion?: string
  targetBackend?: string
}

interface ExtensionSetting {
  key: string
  controllerProps?: {
    value: unknown
  }
}

interface BackendUpdateResult {
  wasUpdated: boolean
  reason?: 'in_progress' | 'error' | string
}

interface ExtensionWithSettings {
  getSettings?: () => Promise<ExtensionSetting[] | undefined>
}

async function getCurrentBackendTypeFromSettings(
  extension: ExtensionWithSettings
): Promise<string> {
  const settings = await extension.getSettings?.()
  const currentBackendSetting = settings?.find(
    (s) => s.key === 'version_backend'
  )
  const currentBackend = currentBackendSetting?.controllerProps?.value as string

  if (!currentBackend) {
    throw new Error('Current backend not found')
  }

  const parts = currentBackend.split('/')
  const currentVersionPart = parts[0]?.trim()
  const currentBackendType = parts[1]?.trim()

  if (parts.length !== 2 || !currentVersionPart || !currentBackendType) {
    throw new Error(
      `Invalid current backend format: "${currentBackend}". Expected "version/backendType".`
    )
  }

  return currentBackendType
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
      // If an update is already in progress, avoid triggering a duplicate update.
      if (updateState.isUpdating) {
        return
      }

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

      const extension = extensionToUse as LlamacppExtension

      // Use the exact target backend from checkBackendForUpdates if available,
      // to avoid mismatches between old/new backend name formats
      let targetBackendString = updateState.updateInfo.targetBackend

      if (targetBackendString) {
        // Validate and normalize the provided target backend string
        const rawParts = targetBackendString.split('/')
        const versionPart = rawParts[0]?.trim()
        const backendTypePart = rawParts[1]?.trim()

        if (rawParts.length !== 2 || !versionPart || !backendTypePart) {
          // Malformed targetBackend; fall back to constructing from current settings
          const currentBackendType = await getCurrentBackendTypeFromSettings(
            extension
          )
          targetBackendString = `${updateState.updateInfo.newVersion}/${currentBackendType}`
        } else {
          // Normalize to "version/backendType" with trimmed parts
          targetBackendString = `${versionPart}/${backendTypePart}`
        }
      } else {
        // Fallback: construct from current settings if targetBackend wasn't provided
        const currentBackendType = await getCurrentBackendTypeFromSettings(
          extension
        )
        targetBackendString = `${updateState.updateInfo.newVersion}/${currentBackendType}`
      }

      // Call the extension's updateBackend method
      const rawResult = await extension.updateBackend?.(targetBackendString)
      const result = rawResult as BackendUpdateResult | undefined

      if (result?.wasUpdated === true) {
        // Reset update state on successful update
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
      } else if (
        result?.wasUpdated === false &&
        (result.reason === 'in_progress' || typeof result.reason === 'undefined')
      ) {
        // Benign no-op (e.g., another update is already in progress or the
        // extension returned a no-op response without a reason). Do not treat
        // this as a failure; just clear the local isUpdating flag.
        setUpdateState((prev) => ({
          ...prev,
          isUpdating: false,
        }))
      } else if (
        result?.wasUpdated === false &&
        result.reason &&
        result.reason !== 'in_progress'
      ) {
        // Explicit failure reason from extension: surface as an error.
        throw new Error(`Backend update failed: ${result.reason}`)
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
  }, [updateState.updateInfo, updateState.isUpdating, syncStateToOtherInstances])

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
