import { redirect } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { isCoworkEnabled } from '@/lib/version'

/**
 * `beforeLoad` guard for every Cowork URL. On a build that does not ship
 * Cowork, a bookmarked `/cowork`, `/artifacts` or `/settings/cowork` link lands
 * on `fallback` instead of mounting a surface that has no entry point left.
 */
export function ensureCoworkEnabled(fallback: string = route.home) {
  if (!isCoworkEnabled()) throw redirect({ to: fallback })
}
