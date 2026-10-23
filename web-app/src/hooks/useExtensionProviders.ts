import { useEffect } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useContributions } from '@/lib/extensions/contributions'
import { getExtensionHost } from '@/lib/extensions/host'
import {
  listExtensionProviders,
  toModelProvider,
  type ActiveExtensionProvider,
} from '@/lib/extensions/providers'

async function resolve(provider: ActiveExtensionProvider): Promise<ModelProvider> {
  const host = getExtensionHost()
  const { extensionId, contribution } = provider
  const [models, apiKey] = await Promise.all([
    host.listProviderModels(extensionId, contribution.id).catch((error) => {
      console.warn(
        `Provider '${contribution.id}' of '${extensionId}' failed to list models:`,
        error
      )
      return undefined
    }),
    contribution.apiKeySetting
      ? host.settings.getSettingValue(extensionId, contribution.apiKeySetting)
      : undefined,
  ])
  return toModelProvider(
    provider,
    models ?? [],
    typeof apiKey === 'string' ? apiKey : undefined
  )
}

/**
 * Mirrors the providers extensions contribute into `useModelProvider`, so
 * they show up in the model picker and run through the host's
 * OpenAI-compatible path. A provider leaves the list when its extension
 * releases it or stops; a change of its API key setting refreshes it.
 */
export function useExtensionProviders() {
  useEffect(() => {
    let generation = 0
    let previous = ''
    const sync = async () => {
      const providers = listExtensionProviders(useContributions.getState())
      const key = JSON.stringify(providers)
      if (key === previous) return
      previous = key
      const current = ++generation
      const resolved = await Promise.all(providers.map(resolve))
      // A newer sync started while this one awaited extension calls.
      if (current !== generation) return
      useModelProvider.setState((state) => ({
        providers: [
          ...state.providers.filter((p) => !p.source),
          ...resolved,
        ],
      }))
    }
    void sync()
    const unsubscribe = useContributions.subscribe(() => void sync())
    const settings = getExtensionHost().settings.onDidChange((change) => {
      const isKey = listExtensionProviders(useContributions.getState()).some(
        (p) =>
          p.extensionId === change.extensionId &&
          p.contribution.apiKeySetting === change.key
      )
      if (!isKey) return
      previous = ''
      void sync()
    })
    return () => {
      unsubscribe()
      settings.dispose()
      generation++
    }
  }, [])
}
