import type { ProviderContribution } from '@janhq/extension-api'
import { i18n } from '@/i18n/react-i18next-compat'
import type { ContributionState } from './contributions'

/**
 * The provider name a contributed provider gets in `useModelProvider`.
 * Namespaced by extension so it can never take over a built-in or a
 * user-created provider of the same name.
 */
export const extensionProviderName = (extensionId: string, providerId: string) =>
  `${extensionId}/${providerId}`

/**
 * Refuses any request to the baseUrl of a provider an extension contributed.
 * Until P3's jar-less Rust fetch, the only network path is plugin-http, which
 * shares the app's cookie jar and follows redirects itself, so a granted
 * host could bounce a chat (body and all) to Jan's local API server or to
 * any other local port, and the grant check at register time would not
 * see it. Such providers stay listed, with the models `listModels` gave;
 * sending to them fails with this error.
 */
export function assertNotExtensionProvider(provider: ModelProvider): void {
  if (provider.source)
    throw new Error(
      i18n.t('model-errors:extensionProviderUnavailable', {
        provider: provider.provider,
      })
    )
}

/** A contributed provider whose extension has activated it. */
export interface ActiveExtensionProvider {
  extensionId: string
  contribution: ProviderContribution
}

/** Every provider an extension declared and bound, in a stable order. */
export function listExtensionProviders(
  state: ContributionState
): ActiveExtensionProvider[] {
  const result: ActiveExtensionProvider[] = []
  for (const extensionId of Object.keys(state.providers).sort()) {
    const providers = state.providers[extensionId]
    for (const id of Object.keys(providers).sort()) {
      const { handler, ...contribution } = providers[id]
      if (handler) result.push({ extensionId, contribution })
    }
  }
  return result
}

/**
 * The `useModelProvider` entry of a contributed provider: OpenAI-compatible,
 * so the host's model factory will run inference against `baseUrl` itself
 * and no token streams over RPC (refused for now, see
 * `assertNotExtensionProvider`). It carries no settings of its own; the base URL
 * is fixed by the manifest and the key lives in the extension's settings.
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
    source: { extensionId: provider.extensionId },
  }
}
