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
] as const

export async function hydrateBackendStores(): Promise<void> {
  await Promise.resolve(useTheme.persist.rehydrate())
  await Promise.all(
    secondaryStores.map((store) => Promise.resolve(store.persist.rehydrate()))
  )
}
