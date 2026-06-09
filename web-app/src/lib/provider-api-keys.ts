import { isXaiOAuthConnectedSync } from '@/lib/xai-oauth'

export const API_KEY_FALLBACKS_SETTING_KEY = 'api-key-fallbacks'

export function serializeApiKeyFallbacks(fallbacks: string[]): string {
  return fallbacks.map((k) => k.trim()).filter((k) => k.length > 0).join('\n')
}

export function parseApiKeyFallbacks(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return []
  return value
    .split(/\r?\n/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * Ordered API keys for a remote provider: primary `api_key` first, then `api_key_fallbacks`.
 */
export function providerRemoteApiKeyChain(provider: {
  api_key?: string
  api_key_fallbacks?: string[]
}): string[] {
  const primary = provider.api_key?.trim()
  const fallbacks = (provider.api_key_fallbacks ?? [])
    .map((k) => String(k).trim())
    .filter((k) => k.length > 0)
  const ordered = [...(primary ? [primary] : []), ...fallbacks]
  const seen = new Set<string>()
  return ordered.filter((k) => {
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function providerHasRemoteApiKeys(provider: {
  api_key?: string
  api_key_fallbacks?: string[]
}): boolean {
  return providerRemoteApiKeyChain(provider).length > 0
}

/**
 * Sync check for whether a remote provider is configured (API keys or xAI OAuth).
 * Use in UI filters; async `providerHasRemoteAuth` is preferred for network calls.
 */
export function providerHasConfiguredRemoteAuth(provider: {
  provider?: string
  api_key?: string
  api_key_fallbacks?: string[]
}): boolean {
  if (providerHasRemoteApiKeys(provider)) return true
  if (provider.provider === 'xai' && isXaiOAuthConnectedSync()) return true
  return false
}

export async function providerRemoteAuthKeyChain(provider: {
  provider?: string
  api_key?: string
  api_key_fallbacks?: string[]
}): Promise<string[]> {
  if (provider.provider === 'xai') {
    const { getXaiOAuthAccessToken } = await import('@/lib/xai-oauth')
    const oauthToken = await getXaiOAuthAccessToken()
    if (oauthToken) return [oauthToken]
  }
  return providerRemoteApiKeyChain(provider)
}

export async function providerHasRemoteAuth(provider: {
  provider?: string
  api_key?: string
  api_key_fallbacks?: string[]
}): Promise<boolean> {
  const keys = await providerRemoteAuthKeyChain(provider)
  return keys.length > 0
}
