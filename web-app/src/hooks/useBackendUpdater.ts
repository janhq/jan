import { useState, useCallback, useEffect, useRef } from 'react'
import { events, AppEvent } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { localStorageKey } from '@/constants/localStorage'

/// Maximum time we wait for a `app:backend-hotswapped` window event after the
/// backend archive download finishes. If the extension's `applyBackendLive()`
/// path throws, no event is ever dispatched — fall back to the legacy
/// "restart required" prompt so the user is not stranded in an indefinite
/// "switching" spinner.
const HOTSWAP_TIMEOUT_MS = 8000

/// How long the "completed" success state stays on screen before the dialog
/// auto-dismisses. Long enough for the user to read the toast / banner,
/// short enough to feel snappy.
const HOTSWAP_COMPLETED_DISMISS_MS = 1500

const BACKEND_HOTSWAPPED_EVENT = 'app:backend-hotswapped'

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
  downloadRecommendedBackend?(backendString: string): Promise<void>
  recheckOptimalBackend?(): Promise<BetterBackendRecommendation | null>
}

export interface BackendDownloadState {
  isDownloading: boolean
  backendName: string | null
  status: 'idle' | 'downloading' | 'completed' | 'failed'
  error?: string
}

export interface BackendUpdateState {
  isUpdateAvailable: boolean
  updateInfo: BackendUpdateInfo | null
  isUpdating: boolean
  remindMeLater: boolean
  autoUpdateEnabled: boolean
}

export interface BetterBackendRecommendation {
  currentBackend: string
  recommendedBackend: string
  recommendedCategory: string
}

export type RecommendationPhase =
  | 'idle'
  | 'recommend'
  | 'downloading'
  | 'hotswapping'
  | 'completed'
  | 'restart-required'

export const useBackendUpdater = () => {
  const [updateState, setUpdateState] = useState<BackendUpdateState>({
    isUpdateAvailable: false,
    updateInfo: null,
    isUpdating: false,
    remindMeLater: false,
    autoUpdateEnabled: false,
  })

  const [downloadState, setDownloadState] = useState<BackendDownloadState>({
    isDownloading: false,
    backendName: null,
    status: 'idle',
  })

  const [recommendation, setRecommendation] = useState<BetterBackendRecommendation | null>(null)
  const [recommendationPhase, setRecommendationPhase] = useState<RecommendationPhase>('idle')

  /// Tracks pending hot-swap fallback timer so it can be cancelled when the
  /// `app:backend-hotswapped` window event arrives in time.
  const hotswapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /// Tracks the auto-dismiss timer for the 'completed' success state.
  const completedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHotswapTimeout = useCallback(() => {
    if (hotswapTimeoutRef.current) {
      clearTimeout(hotswapTimeoutRef.current)
      hotswapTimeoutRef.current = null
    }
  }, [])

  const clearCompletedTimeout = useCallback(() => {
    if (completedTimeoutRef.current) {
      clearTimeout(completedTimeoutRef.current)
      completedTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearHotswapTimeout()
      clearCompletedTimeout()
    }
  }, [clearHotswapTimeout, clearCompletedTimeout])

  // On mount, check localStorage for a recommendation that was persisted
  // by the extension before React mounted (avoids event race condition
  // during the in-flight onboarding step).
  //
  // Suppress this auto-restore once any of these terminal flags is set:
  //   - `llama_cpp_onboarding_done` — user finished the dedicated step.
  //   - `setup-completed` — legacy users who never went through the new
  //     onboarding (pre-existing installs upgrading to this version).
  // After that point any surfacing must come from a fresh Tauri event,
  // either via the gated `configureBackends()` path or the manual
  // "Find optimal backend" button (`recheckOptimalBackend()`).
  useEffect(() => {
    try {
      if (
        localStorage.getItem(localStorageKey.llamacppOnboardingDone) ||
        localStorage.getItem(localStorageKey.setupCompleted) === 'true'
      ) {
        return
      }
      const stored = localStorage.getItem('llama_cpp_better_backend_recommendation')
      if (stored) {
        const payload: BetterBackendRecommendation = JSON.parse(stored)
        if (payload.recommendedBackend && payload.recommendedCategory) {
          console.log('Better backend recommendation restored from localStorage:', payload)
          setRecommendation(payload)
          setRecommendationPhase('recommend')
        }
      }
    } catch {
      // Corrupted data — ignore
    }
  }, [])

  // Listen for the better-backend detection event from the extension
  useEffect(() => {
    const handleBetterBackendDetected = (payload: BetterBackendRecommendation) => {
      console.log('Better backend detected (event):', payload)
      setRecommendation(payload)
      setRecommendationPhase((prev) => {
        if (prev === 'downloading' || prev === 'restart-required') return prev
        return 'recommend'
      })
    }

    events.on(AppEvent.onBetterBackendDetected, handleBetterBackendDetected)

    return () => {
      events.off(AppEvent.onBetterBackendDetected, handleBetterBackendDetected)
    }
  }, [])

  // Listen for backend download events from the extension.
  //
  // Cross-instance phase sync: each `useBackendUpdater()` call is a
  // separate React state owner, so when one component (e.g. the
  // settings page) starts a download the global `<BackendUpdater />`
  // mounted in `__root.tsx` would otherwise stay frozen in 'recommend'.
  // Use the `payload.backend === recommendation.recommendedBackend`
  // match to drive the phase transitions from events alone, regardless
  // of which component initiated the download.
  useEffect(() => {
    const handleDownloadStarted = (payload: { backend: string; status: string }) => {
      setDownloadState({
        isDownloading: true,
        backendName: payload.backend,
        status: 'downloading',
      })
      if (
        recommendation &&
        payload.backend === recommendation.recommendedBackend &&
        recommendationPhase !== 'restart-required'
      ) {
        setRecommendationPhase('downloading')
      }
    }

    const handleDownloadFinished = (payload: {
      backend: string
      status: 'completed' | 'failed'
      error?: string
    }) => {
      setDownloadState({
        isDownloading: false,
        backendName: payload.backend,
        status: payload.status,
        error: payload.error,
      })

      const targetsRecommendation =
        !!recommendation && payload.backend === recommendation.recommendedBackend

      if (payload.status === 'completed') {
        if (recommendationPhase === 'downloading' || targetsRecommendation) {
          // Move to 'hotswapping' and arm a fallback timer in case the
          // extension's `applyBackendLive()` path silently fails (no
          // `app:backend-hotswapped` event will be dispatched in that
          // case). On timeout we revert to the legacy restart-required
          // UX so the user is never stuck in an indefinite spinner.
          setRecommendationPhase('hotswapping')
          clearHotswapTimeout()
          hotswapTimeoutRef.current = setTimeout(() => {
            hotswapTimeoutRef.current = null
            setRecommendationPhase((prev) =>
              prev === 'hotswapping' ? 'restart-required' : prev
            )
          }, HOTSWAP_TIMEOUT_MS)
        }
      } else if (payload.status === 'failed') {
        if (recommendationPhase === 'downloading' || targetsRecommendation) {
          setRecommendationPhase('recommend')
        }
      }
    }

    events.on(AppEvent.onBackendDownloadStarted, handleDownloadStarted)
    events.on(AppEvent.onBackendDownloadFinished, handleDownloadFinished)

    return () => {
      events.off(AppEvent.onBackendDownloadStarted, handleDownloadStarted)
      events.off(AppEvent.onBackendDownloadFinished, handleDownloadFinished)
    }
  }, [recommendationPhase, recommendation, clearHotswapTimeout])

  // Listen for the live hot-swap completion event dispatched by
  // `applyBackendLive()` in the llamacpp extension. The event arrives on
  // the DOM `window` because the extension does not depend on the
  // `@janhq/core` event bus for this purely UI-facing transition.
  useEffect(() => {
    const handleHotswapped = () => {
      clearHotswapTimeout()
      setRecommendationPhase('completed')
      clearCompletedTimeout()
      completedTimeoutRef.current = setTimeout(() => {
        completedTimeoutRef.current = null
        setRecommendation(null)
        setRecommendationPhase('idle')
      }, HOTSWAP_COMPLETED_DISMISS_MS)
    }

    window.addEventListener(BACKEND_HOTSWAPPED_EVENT, handleHotswapped)
    return () => {
      window.removeEventListener(BACKEND_HOTSWAPPED_EVENT, handleHotswapped)
    }
  }, [clearHotswapTimeout, clearCompletedTimeout])

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

  const syncStateToOtherInstances = useCallback(
    (partialState: Partial<BackendUpdateState>) => {
      events.emit('onBackendUpdateStateSync', partialState)
    },
    []
  )

  const dismissRecommendation = useCallback(() => {
    setRecommendationPhase('idle')
    // Don't remove from localStorage — popup should reappear on next launch
  }, [])

  /// `overrideBackend` lets callers bypass the closure-captured
  /// `recommendation` state. Necessary when the trigger fires
  /// immediately after `recheckOptimalBackend()` resolves — at that
  /// point the `setRecommendation()` from inside the hook has not yet
  /// committed, so the closure here would still see the previous value
  /// (frequently `null`) and bail via the early return.
  const downloadRecommendedBackend = useCallback(
    async (overrideBackend?: string) => {
      const targetBackend = overrideBackend ?? recommendation?.recommendedBackend
      if (!targetBackend) return

      setRecommendationPhase('downloading')

      try {
        const llamacppExtension =
          ExtensionManager.getInstance().getByName('llamacpp-extension')
        let extensionToUse = llamacppExtension

        if (!llamacppExtension) {
          const allExtensions = ExtensionManager.getInstance().listExtensions()
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
          !('downloadRecommendedBackend' in extensionToUse)
        ) {
          throw new Error(
            'Extension does not support downloadRecommendedBackend'
          )
        }

        const extension = extensionToUse as LlamacppExtension
        await extension.downloadRecommendedBackend?.(targetBackend)
      } catch (error) {
        console.error('Error downloading recommended backend:', error)
        setRecommendationPhase('recommend')
        throw error
      }
    },
    [recommendation]
  )

  /// Manual trigger that re-runs hardware detection on the extension side
  /// and surfaces the recommendation dialog when a better backend exists.
  /// Returns the recommendation payload, or `null` when the device is
  /// already on the optimal backend (callers typically toast in that case).
  const recheckOptimalBackend = useCallback(async () => {
    const allExtensions = ExtensionManager.getInstance().listExtensions()
    const llamacppExtension =
      ExtensionManager.getInstance().getByName('llamacpp-extension')

    let extensionToUse = llamacppExtension

    if (!llamacppExtension) {
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

    if (!extensionToUse || !('recheckOptimalBackend' in extensionToUse)) {
      throw new Error('Extension does not support recheckOptimalBackend')
    }

    const extension = extensionToUse as LlamacppExtension
    const result = await extension.recheckOptimalBackend?.()
    if (result) {
      // Mirror the event payload into local state so the dialog opens
      // immediately even when the Tauri event arrives after the await
      // completes (avoids a perceptible UI lag on the Settings button).
      setRecommendation(result)
      setRecommendationPhase((prev) =>
        prev === 'downloading' || prev === 'restart-required' ? prev : 'recommend'
      )
    }
    return result ?? null
  }, [])

  const checkForUpdate = useCallback(
    async (resetRemindMeLater = false) => {
      try {
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

        const allExtensions = ExtensionManager.getInstance().listExtensions()

        const llamacppExtension =
          ExtensionManager.getInstance().getByName('llamacpp-extension')

        let extensionToUse = llamacppExtension

        if (!llamacppExtension) {
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
      if (updateState.isUpdating) {
        return
      }

      setUpdateState((prev) => ({
        ...prev,
        isUpdating: true,
      }))

      const allExtensions = ExtensionManager.getInstance().listExtensions()
      const llamacppExtension =
        ExtensionManager.getInstance().getByName('llamacpp-extension')

      let extensionToUse = llamacppExtension

      if (!llamacppExtension) {
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

      let targetBackendString = updateState.updateInfo.targetBackend

      if (targetBackendString) {
        const rawParts = targetBackendString.split('/')
        const versionPart = rawParts[0]?.trim()
        const backendTypePart = rawParts[1]?.trim()

        if (rawParts.length !== 2 || !versionPart || !backendTypePart) {
          const currentBackendType =
            await getCurrentBackendTypeFromSettings(extension)
          targetBackendString = `${updateState.updateInfo.newVersion}/${currentBackendType}`
        } else {
          targetBackendString = `${versionPart}/${backendTypePart}`
        }
      } else {
        const currentBackendType =
          await getCurrentBackendTypeFromSettings(extension)
        targetBackendString = `${updateState.updateInfo.newVersion}/${currentBackendType}`
      }

      const rawResult = await extension.updateBackend?.(targetBackendString)
      const result = rawResult as BackendUpdateResult | undefined

      if (result?.wasUpdated === true) {
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
        (result.reason === 'in_progress' ||
          typeof result.reason === 'undefined')
      ) {
        setUpdateState((prev) => ({
          ...prev,
          isUpdating: false,
        }))
      } else if (
        result?.wasUpdated === false &&
        result.reason &&
        result.reason !== 'in_progress'
      ) {
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
  }, [
    updateState.updateInfo,
    updateState.isUpdating,
    syncStateToOtherInstances,
  ])

  const installBackend = useCallback(async (filePath: string) => {
    try {
      const allExtensions = ExtensionManager.getInstance().listExtensions()
      const llamacppExtension =
        ExtensionManager.getInstance().getByName('llamacpp-extension')

      let extensionToUse = llamacppExtension

      if (!llamacppExtension) {
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

      const extension = extensionToUse as LlamacppExtension
      await extension.installBackend?.(filePath)

      await extension.configureBackends?.()
    } catch (error) {
      console.error('Error installing backend:', error)
      throw error
    }
  }, [])

  return {
    updateState,
    downloadState,
    recommendation,
    recommendationPhase,
    checkForUpdate,
    updateBackend,
    setRemindMeLater,
    installBackend,
    dismissRecommendation,
    downloadRecommendedBackend,
    recheckOptimalBackend,
  }
}
