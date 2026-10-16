/**
 * Tauri's HTTP plugin injects the webview origin (`http://tauri.localhost`)
 * unless `Origin` is present. With `unsafe-headers` enabled, an empty `Origin`
 * tells the plugin to omit the header entirely — CORS-strict backends
 * (Ollama, nginx) 403 on the webview origin.
 */

export function isTauriWebviewOrigin(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.toLowerCase() === 'null' || v.toLowerCase() === 'tauri://localhost') {
    return true
  }
  try {
    const host = new URL(v).hostname
    return host.toLowerCase() === 'tauri.localhost'
  } catch {
    return false
  }
}

/**
 * Ensure outbound provider requests do not carry the Tauri webview Origin
 * (or a Referer that points at it). An empty Origin is the plugin-http
 * signal to strip the header; a caller-supplied non-webview Origin is kept.
 */
export function headersWithoutTauriWebviewOrigin(
  headers?: HeadersInit
): HeadersInit {
  if (
    !headers ||
    (typeof headers === 'object' &&
      !(headers instanceof Headers) &&
      !Array.isArray(headers))
  ) {
    const out: Record<string, string> = headers
      ? { ...(headers as Record<string, string>) }
      : {}
    const originKey = Object.keys(out).find((k) => k.toLowerCase() === 'origin')
    const origin = originKey ? out[originKey] : undefined
    if (originKey) delete out[originKey]
    if (!origin || isTauriWebviewOrigin(origin)) {
      out.Origin = ''
    } else if (originKey) {
      out[originKey] = origin
    }
    const refererKey = Object.keys(out).find((k) => k.toLowerCase() === 'referer')
    if (refererKey && isTauriWebviewOrigin(out[refererKey])) {
      delete out[refererKey]
    }
    return out
  }

  const h = new Headers(headers)
  const origin = h.get('Origin')
  if (!origin || isTauriWebviewOrigin(origin)) {
    h.set('Origin', '')
  }
  const referer = h.get('Referer')
  if (referer && isTauriWebviewOrigin(referer)) {
    h.delete('Referer')
  }
  return h
}

export function fetchWithoutTauriWebviewOrigin(
  baseFetch: typeof fetch
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = headersWithoutTauriWebviewOrigin(init?.headers)
    return baseFetch(input, { ...init, headers })
  }) as typeof fetch
}
