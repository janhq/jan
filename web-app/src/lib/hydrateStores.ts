import { useTheme } from '@/hooks/useTheme'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  useProductAnalytic,
  useProductAnalyticPrompt,
} from '@/hooks/useAnalytic'
import { useHardware } from '@/hooks/useHardware'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { useVulkan } from '@/hooks/useVulkan'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { useLatestJanModel } from '@/hooks/useLatestJanModel'
import { useJanModelPromptDismissed } from '@/hooks/useJanModelPrompt'
import { useDefaultEmbeddingModel } from '@/hooks/useDefaultEmbeddingModel'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkConfig } from '@/hooks/useCoworkConfig'
import { useChatShell } from '@/hooks/useChatShell'
import { useCoTDuration } from '@/hooks/useCoTDuration'
import { useImageAttachmentConfig } from '@/hooks/useImageAttachmentConfig'

/**
 * Stores persisted through `backendStorage` set `skipHydration: true` so they
 * never hit the backend before the ServiceHub is initialized. This runs their
 * rehydration explicitly, once, after init. Called from `ServiceHubProvider`
 * before it renders children, so no component ever sees pre-hydration defaults.
 *
 * Add each migrated store here as it is switched to `backendStorage`.
 */
// useInterfaceSettings' onRehydrateStorage reads useTheme.getState().isDark, so
// theme must hydrate first.
const secondaryStores = [
  useInterfaceSettings,
  useGeneralSetting,
  useLeftPanel,
  useModelProvider,
  useProductAnalytic,
  useProductAnalyticPrompt,
  useHardware,
  useLocalApiServer,
  useToolApproval,
  useToolAvailable,
  useDownloadStore,
  useProxyConfig,
  useVulkan,
  useFavoriteModel,
  useLatestJanModel,
  useJanModelPromptDismissed,
  useDefaultEmbeddingModel,
  useAgentMode,
  useWebSearchConfig,
  useCoworkSessions,
  useCoworkConfig,
  useChatShell,
  useCoTDuration,
  useImageAttachmentConfig,
] as const

type BackendStore = {
  persist: {
    rehydrate: () => void | Promise<void>
    hasHydrated: () => boolean
  }
}

const hydrateStore = async (store: BackendStore): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await store.persist.rehydrate()
    } catch {
      // Custom storage can reject directly; Zustand itself catches failures.
    }
    // Zustand's rehydrate promise resolves even when its storage read failed.
    if (store.persist.hasHydrated()) return
  }
  throw new Error('Persisted settings could not be hydrated after three attempts')
}

let hydration: Promise<void> | undefined

export function hydrateBackendStores(): Promise<void> {
  if (hydration) return hydration
  hydration = (async () => {
    const theme = await Promise.allSettled([hydrateStore(useTheme)])
    // Try every store even if theme failed. Its read must run so the storage
    // guard protects its saved settings before initialization can fall back.
    const secondary = await Promise.allSettled(secondaryStores.map(hydrateStore))
    const failed = [...theme, ...secondary].find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  })().finally(() => {
    hydration = undefined
  })
  return hydration
}
