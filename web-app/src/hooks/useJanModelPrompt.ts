import { localStorageKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useModelProvider } from './useModelProvider'
import { useDownloadStore } from './useDownloadStore'
import { useLatestJanModel } from './useLatestJanModel'
import { predefinedProviders } from '@/constants/providers'

export type JanModelPromptDismissedState = {
  dismissed: boolean
  setDismissed: (value: boolean) => void
}

export const useJanModelPromptDismissed =
  create<JanModelPromptDismissedState>()(
    persist(
      (set) => ({
        dismissed: false,
        setDismissed: (value: boolean) => set({ dismissed: value }),
      }),
      {
        name: localStorageKey.janModelPromptDismissed,
        storage: createJSONStorage(() => localStorage),
      }
    )
  )

const TARGET_VERSION = '0.7.6'

export const useJanModelPrompt = () => {
  const { dismissed, setDismissed } = useJanModelPromptDismissed()
  const { getProviderByName, providers } = useModelProvider()
  const { localDownloadingModels } = useDownloadStore()
  const latestModel = useLatestJanModel((state) => state.model)

  const llamaProvider = getProviderByName('llamacpp')
  const setupCompleted =
    localStorage.getItem(localStorageKey.setupCompleted) === 'true'

  // Only show for specific version
  const isTargetVersion = VERSION.startsWith(TARGET_VERSION)

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

  const showJanModelPrompt =
    isTargetVersion &&
    !isOnSetupScreen &&
    !setupCompleted &&
    !dismissed &&
    latestModel != null &&
    !isJanModelDownloaded &&
    !isDownloading

  return {
    showJanModelPrompt,
    dismissed,
    setDismissed,
    isJanModelDownloaded,
    isDownloading,
  }
}
