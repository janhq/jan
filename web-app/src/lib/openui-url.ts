const ALLOWED_OPENUI_URL_PROTOCOLS = new Set(['http:', 'https:'])

export function getSafeOpenUIUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const candidate = value.trim()
  if (!candidate) return null

  try {
    const url = new URL(candidate)
    return ALLOWED_OPENUI_URL_PROTOCOLS.has(url.protocol.toLowerCase())
      ? candidate
      : null
  } catch {
    return null
  }
}
