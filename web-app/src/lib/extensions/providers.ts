import type { ProviderContribution } from '@janhq/extension-api'
import type { ContributionState } from './contributions'

/**
 * The provider name a contributed provider gets in `useModelProvider`.
 * Namespaced by extension so it can never take over a built-in or a
 * user-created provider of the same name.
 */
export const extensionProviderName = (extensionId: string, providerId: string) =>
  `${extensionId}/${providerId}`

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
 * so the host's model factory runs inference against `baseUrl` itself and
 * no token streams over RPC. It carries no settings of its own; the base URL
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
