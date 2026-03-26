import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useModelProvider } from './useModelProvider'
import { useDownloadStore } from './useDownloadStore'
import { useLatestJanModel } from './useLatestJanModel'
import { predefinedProviders } from '@/constants/providers'

export type JanModelPromptDismissedState = {
  dismissedModelName: string | null
  setDismissedModelName: (modelName: string) => void
}

export const useJanModelPromptDismissed =
  create<JanModelPromptDismissedState>()(
    persist(
      (set) => ({
        dismissedModelName: null,
        setDismissedModelName: (modelName: string) =>
          set({ dismissedModelName: modelName }),
      }),
      {
        name: localStorageKey.janModelPromptDismissed,
        storage: createJSONStorage(() => fileStorage),
        version: 1,
        migrate: (persistedState: unknown) => {
          const state = persistedState as Record<string, unknown>
          if ('dismissed' in state && !('dismissedModelName' in state)) {
            return { dismissedModelName: null }
          }
          return state as JanModelPromptDismissedState
        },
      }
    )
  )

const MIN_VERSION = '0.7.6'

export const useJanModelPrompt = () => {
  const { dismissedModelName, setDismissedModelName } =
    useJanModelPromptDismissed()
  const { getProviderByName, providers } = useModelProvider()
  const { localDownloadingModels } = useDownloadStore()
  const latestModel = useLatestJanModel((state) => state.model)

  const llamaProvider = getProviderByName('llamacpp')

  // Only show for versions >= MIN_VERSION
  const isTargetVersion = VERSION >= MIN_VERSION

  // Check if user would be on SetupScreen (no valid providers)
  const hasValidProviders = providers.some((provider) => {
    const isPredefinedProvider = predefinedProviders.some(
      (p) => p.provider === provider.provider
    )
    if (!isPredefinedProvider) {
      return provider.models.length > 0
    }
    return (
      provider.api_key?.length ||
      (provider.provider === 'llamacpp' && provider.models.length) ||
      (provider.provider === 'jan' && provider.models.length)
    )
  })
  const isOnSetupScreen = !hasValidProviders

  // Build set of known quant model IDs from the latest Jan model
  const latestModelQuantIds = new Set(
    latestModel?.quants?.map((q) => q.model_id.toLowerCase()) ?? []
  )

  // Check if any variant of the latest Jan model is downloaded
  const isJanModelDownloaded =
    latestModelQuantIds.size > 0 &&
    (llamaProvider?.models.some(
      (m: { id: string }) => latestModelQuantIds.has(m.id.toLowerCase())
    ) ?? false)

  // Check if currently downloading any variant
  const isDownloading =
    latestModelQuantIds.size > 0 &&
    Array.from(localDownloadingModels).some(
      (id) => latestModelQuantIds.has(id.toLowerCase())
    )

  // Dismissed only applies to the current latest model
  const isDismissed =
    latestModel != null &&
    dismissedModelName === latestModel.model_name

  const showJanModelPrompt =
    isTargetVersion &&
    !isOnSetupScreen &&
    !isDismissed &&
    latestModel != null &&
    !isJanModelDownloaded &&
    !isDownloading

  return {
    showJanModelPrompt,
    setDismissedModelName,
    isJanModelDownloaded,
    isDownloading,
  }
}
