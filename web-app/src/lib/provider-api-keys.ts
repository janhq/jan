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
