/**
 * Platform-aware HTTP fetch: uses Tauri's native HTTP plugin when running inside
 * the desktop webview (avoiding browser CORS restrictions on external registries
 * like ollama.com and registry.ollama.ai) and falls back to standard fetch in
 * web/test environments.
 */
export async function platformFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(input, init)
  }
  return fetch(input, init)
}
