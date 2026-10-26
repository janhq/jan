import type { ProviderContribution } from '@janhq/extension-api'
import { i18n } from '@/i18n/react-i18next-compat'
import type { ContributionState } from './contributions'
import { getExtensionHost } from './host'
import type { ProviderFetchMode } from './http'

/**
 * The provider name a contributed provider gets in `useModelProvider`.
 * Namespaced by extension so it can never take over a built-in or a
 * user-created provider of the same name.
 */
export const extensionProviderName = (extensionId: string, providerId: string) =>
  `${extensionId}/${providerId}`

/**
 * The `fetch` for a provider an extension contributed, or undefined for any
 * other provider. Every request then runs on the extension's own network
 * path (`ExtensionHost.providerFetch`): its grants are checked on each URL
 * and redirect hop, so a granted host cannot bounce a chat to Jan's local
 * API server or any other port, and no cookie jar is attached. Throws when
 * the extension has no network path: it is not running, or it was loaded
 * for development. `whole` suits short JSON requests (model listing, key
 * tests): they get the plugin's 30 s timeout instead of the stream's.
 */
export function extensionProviderFetch(
  provider: Pick<ModelProvider, 'provider' | 'source'>,
  mode: ProviderFetchMode
): typeof globalThis.fetch | undefined {
  if (!provider.source) return undefined
  const fetch = getExtensionHost().providerFetch(
    provider.source.extensionId,
    mode
  )
  if (!fetch)
    throw new Error(
      i18n.t('model-errors:extensionProviderUnavailable', {
        provider: provider.provider,
      })
    )
  return fetch
}

/** A contributed provider whose extension has activated it. */
export interface ActiveExtensionProvider {
  extensionId: string
  /** The manifest `displayName` of the extension. */
  extensionName: string
  contribution: ProviderContribution
}

/** Every provider an extension declared and bound, in a stable order. */
export function listExtensionProviders(
  state: ContributionState
): ActiveExtensionProvider[] {
  const result: ActiveExtensionProvider[] = []
  for (const extensionId of Object.keys(state.providers).sort()) {
    const providers = state.providers[extensionId]
    const extensionName =
      state.extensions[extensionId]?.displayName ?? extensionId
    for (const id of Object.keys(providers).sort()) {
      const { handler, ...contribution } = providers[id]
      if (handler) result.push({ extensionId, extensionName, contribution })
    }
  }
  return result
}

/**
 * The `useModelProvider` entry of a contributed provider: OpenAI-compatible,
 * so the host's model factory runs inference against `baseUrl` itself (on
 * `extensionProviderFetch`) and no token streams over RPC. It carries no
 * settings of its own; the base URL is fixed by the manifest and the key
 * lives in the extension's settings.
 */
export function toModelProvider(
  provider: ActiveExtensionProvider,
  models: { id: string; displayName?: string }[],
  apiKey: string | undefined
): ModelProvider {
  return {
    provider: extensionProviderName(
      provider.extensionId,
      provider.contribution.id
    ),
    display_name: provider.contribution.displayName,
    active: true,
    base_url: provider.contribution.baseUrl,
    api_key: apiKey || undefined,
    settings: [],
    models: models.map((m) => ({
      id: m.id,
      name: m.displayName ?? m.id,
      displayName: m.displayName,
      capabilities: ['completion'],
    })),
    source: {
      extensionId: provider.extensionId,
      extensionName: provider.extensionName,
    },
  }
}
