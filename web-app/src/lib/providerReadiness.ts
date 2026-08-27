import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'

type ModelLike = {
  id: string
  embedding?: boolean
  capabilities?: string[]
}

type ProviderLike = {
  provider: string
  models?: ModelLike[]
  api_key?: string
  api_key_fallbacks?: string[]
}

/** Local engines are usable on models alone; they need no credential. */
const KEYLESS_PREDEFINED_PROVIDERS = ['llamacpp', 'jan']

/**
 * An embedding model cannot answer a message. Jan installs one on its own during
 * first-run setup, so counting it would end onboarding before the user has any
 * model to chat with.
 */
function isChatCapable(model: ModelLike): boolean {
  return !model.embedding && !model.capabilities?.includes('embeddings')
}

/**
 * Whether the user can actually send a message through this provider: a
 * credential for a remote one, or an installed model for a local or custom one.
 * Naming a model is not enough for a remote provider, since nothing can serve it
 * without a key.
 */
export function isProviderUsable(provider: ProviderLike): boolean {
  const hasModels = (provider.models ?? []).some(isChatCapable)

  const isPredefined = predefinedProviders.some(
    (p) => p.provider === provider.provider
  )
  // A custom provider is a user-configured endpoint, so models alone qualify.
  if (!isPredefined) return hasModels

  return (
    providerHasRemoteApiKeys(provider) ||
    (KEYLESS_PREDEFINED_PROVIDERS.includes(provider.provider) && hasModels)
  )
}

/**
 * The gate that decides whether onboarding is still required. Shared so the
 * setup route and the post-setup nudge cannot drift apart.
 */
export function hasUsableProvider(providers: ProviderLike[]): boolean {
  return (providers ?? []).some(isProviderUsable)
}
