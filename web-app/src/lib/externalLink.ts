import { openUrl } from '@tauri-apps/plugin-opener'
import { isPlatformTauri } from '@/lib/platform/utils'

/** Schemes a link may open, always outside the app. */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * The absolute URL `href` names when it should open in the system browser (or
 * mail client), else `null`. Relative paths, fragments and every other scheme
 * (`javascript:`, `file:`, `asset:`, app routes, ...) return `null`.
 */
export function externalHref(href: string | undefined | null): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/**
 * Open a URL outside the app. On desktop this goes through the opener plugin:
 * the app window itself must never navigate away from the app.
 */
export function openExternalUrl(url: string): void {
  if (isPlatformTauri()) {
    void openUrl(url).catch((error) =>
      console.error('Failed to open external URL:', error)
    )
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
