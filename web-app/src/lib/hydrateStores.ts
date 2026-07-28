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
import { useCodeSessions } from '@/hooks/useCodeSessions'

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
  useCodeSessions,
] as const

export async function hydrateBackendStores(): Promise<void> {
  try {
    await Promise.resolve(useTheme.persist.rehydrate())
  } catch (error) {
    console.error('Failed to rehydrate useTheme:', error)
  }
  // allSettled, not all: one store's rehydrate rejecting must not stop the
  // rest from loading. Promise.all previously fast-failed the whole batch on
  // the first rejection, so ServiceHubProvider's catch could flip isReady and
  // render children before, say, useModelProvider had actually finished —
  // its startup setProviders() call then ran against an empty store and
  // silently dropped any custom (non-predefined) provider from persistence.
  const results = await Promise.allSettled(
    secondaryStores.map((store) => Promise.resolve(store.persist.rehydrate()))
  )
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const name = secondaryStores[i].persist.getOptions().name
      console.error(`Failed to rehydrate store "${name}":`, result.reason)
    }
  })
}
