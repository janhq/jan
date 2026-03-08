import { localStorageKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useModelProvider } from './useModelProvider'
import { useDownloadStore } from './useDownloadStore'
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

  // Check if any Jan v3 variant is downloaded
  const isJanModelDownloaded =
    llamaProvider?.models.some(
      (m: { id: string }) =>
        m.id.toLowerCase().includes('jan-v3') ||
        m.id.toLowerCase().includes('jan_v3')
    ) ?? false

  // Check if currently downloading
  const isDownloading = Array.from(localDownloadingModels).some(
    (id) =>
      id.toLowerCase().includes('jan-v3') ||
      id.toLowerCase().includes('jan_v3')
  )

  const showJanModelPrompt =
    isTargetVersion &&
    !isOnSetupScreen &&
    !setupCompleted &&
    !dismissed &&
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
