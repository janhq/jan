import { localStorageKey } from '@/constants/localStorage'

export interface WebdataResetFlags {
  keepAppData: boolean
  keepModelsAndConfigs: boolean
  clearWebData?: boolean
}

/**
 * Remove webview-persisted UI state matching what a factory reset wiped, so the
 * app rehydrates from the (now empty) disk instead of stale localStorage.
 *
 * Runs at startup before the Zustand stores hydrate (driven by a Rust sentinel)
 * — the only race-free, cross-platform way to clear localStorage, since
 * renderer-side removal before restart never flushes and the on-disk location
 * is platform-specific (esp. macOS WKWebView).
 */
export function pruneLocalStorageByFlags(flags: WebdataResetFlags): void {
  if (typeof localStorage === 'undefined') return

  const k = localStorageKey
  const remove = (keys: string[]) =>
    keys.forEach((key) => localStorage.removeItem(key))

  if (!flags.keepModelsAndConfigs) {
    remove([
      k.modelProvider,
      k.modelSources,
      k.lastUsedModel,
      k.lastUsedAssistant,
      k.defaultAssistantId,
      k.favoriteModels,
      k.latestJanModel,
      k.defaultEmbeddingModel,
      k.modelSupportCache,
      k.janModelPromptDismissed,
      k.pausedDownloads,
    ])
  }

  if (!flags.keepAppData) {
    remove([k.threads, k.messages, k.threadManagement, k.recentSearches])
  }

  // A full wipe should land back on first-run onboarding.
  if (!flags.keepAppData && !flags.keepModelsAndConfigs) {
    remove([k.setupCompleted])
  }
}
