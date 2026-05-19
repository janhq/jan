import { invoke } from '@tauri-apps/api/core'

type ProviderCustomHeaderPayload = {
  header: string
  value: string
}

type RegisterProviderRequest = {
  provider: string
  api_key?: string
  base_url?: string
  custom_headers: ProviderCustomHeaderPayload[]
  models: string[]
}

export const LOCAL_PROVIDER_NAMES = ['llamacpp', 'llamacpp-upstream', 'mlx', 'foundation-models'] as const
export type LocalProviderName = (typeof LOCAL_PROVIDER_NAMES)[number]

export function isLocalProvider(providerName: string | undefined | null): boolean {
  if (!providerName) return false
  return (LOCAL_PROVIDER_NAMES as readonly string[]).includes(providerName)
}

/**
 * Idempotently register a remote (cloud) provider with the Tauri backend
 * so the Local API Server proxy can route requests for its models.
 *
 * Returns true when registration actually happened (provider is remote and has
 * an API key), false when it was skipped (local provider or no key), and
 * throws on backend errors.
 */
export async function registerRemoteProvider(
  provider: ModelProvider
): Promise<boolean> {
  if (isLocalProvider(provider.provider)) {
    return false
  }

  if (!provider.api_key) {
    console.log(
      `[registerRemoteProvider] Provider ${provider.provider} has no API key, skipping registration`
    )
    return false
  }

  const request: RegisterProviderRequest = {
    provider: provider.provider,
    api_key: provider.api_key,
    base_url: provider.base_url,
    custom_headers: (provider.custom_header || []).map((h) => ({
      header: h.header,
      value: h.value,
    })),
    models: provider.models.map((e) => e.id),
  }

  await invoke('register_provider_config', { request })
  console.log(`[registerRemoteProvider] Registered remote provider: ${provider.provider}`)
  return true
}

/**
 * Unregister a previously registered remote provider. Safely swallows errors
 * because the proxy may simply not have the provider registered.
 */
export async function unregisterRemoteProvider(providerName: string): Promise<void> {
  if (isLocalProvider(providerName)) return
  try {
    await invoke('unregister_provider_config', { provider: providerName })
  } catch (error) {
    console.debug(
      `[registerRemoteProvider] Failed to unregister ${providerName} (may already be absent):`,
      error
    )
  }
}
