/**
 * Detect asset references in generated HTML that cannot resolve inside the
 * artifact iframe's opaque-origin sandbox.
 *
 * The preview mounts model HTML in an iframe with no allow-same-origin, so a
 * relative reference (`./logo.png`, `style.css`, `app.js`) has no base URL to
 * resolve against and fails silently — the page renders visibly broken with no
 * explanation. We scan `src`/`href` attributes for values that are neither
 * absolute (http/https), inline (data:/blob:), nor page-internal anchors, and
 * surface the count so the user knows the page is missing assets instead of
 * staring at a blank spot.
 */

/** URL schemes that resolve without a base URL. */
const RESOLVABLE_SCHEME_RE = /^(?:data|blob|https?|mailto|tel|ftp):/i

/** src/href attribute value, e.g. `./logo.png`, `style.css`, `#section`. */
const ATTR_VALUE_RE = /(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi

function isResolvable(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (RESOLVABLE_SCHEME_RE.test(trimmed)) return true
  // Same-document anchor: no network fetch, resolves in the sandbox.
  if (trimmed.startsWith('#')) return true
  // Protocol-relative, absolute-path, or relative refs need a base URL the
  // opaque-origin iframe does not have.
  return false
}

/**
 * Count of src/href values in `html` that cannot resolve in the sandboxed
 * artifact iframe. Returns 0 for empty or non-HTML input; duplicates count
 * (each reference is a separate failed fetch).
 */
export function countUnresolvedAssetRefs(html: string): number {
  if (!html) return 0
  let count = 0
  for (const match of html.matchAll(ATTR_VALUE_RE)) {
    const value = match[2] ?? match[3] ?? ''
    if (!isResolvable(value)) count += 1
  }
  return count
}
