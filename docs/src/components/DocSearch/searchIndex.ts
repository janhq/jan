// Nextra emits a search index at `nextra-data-<locale>.json` during the
// production build. `en-US` is nextra-theme-docs' DEFAULT_LOCALE and this site
// configures no i18n, so that is the only locale ever built.
//
// We read that artifact directly rather than rendering Nextra's own <Search />:
// theme.config.tsx replaces the default navbar with our custom <Navbar />, and
// nextra-theme-docs v2 does not export Search, so there is nothing to mount.
// Scoring 125 routes in plain JS is fast enough that flexsearch buys us nothing.
export const SEARCH_INDEX_URL = '/_next/static/chunks/nextra-data-en-US.json'

// Section keys are `"<anchor>#<Heading>"`, or `""` for the page's own intro.
export type NextraIndex = Record<
  string,
  { title: string; data: Record<string, string> }
>

export type Hit = {
  /** Route with the section anchor already appended. */
  href: string
  /** Page title, always present. */
  title: string
  /** Section heading, empty when the hit is the page intro. */
  heading: string
  excerpt: string
  score: number
}

const EXCERPT_LEN = 140

/** Pull a window of `content` around the earliest matching token. */
function buildExcerpt(content: string, tokens: string[]): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()

  let at = -1
  for (const token of tokens) {
    const i = lower.indexOf(token)
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  if (at === -1) return flat.slice(0, EXCERPT_LEN)

  const start = Math.max(0, at - Math.floor(EXCERPT_LEN / 3))
  const slice = flat.slice(start, start + EXCERPT_LEN)
  return `${start > 0 ? '…' : ''}${slice}${
    start + EXCERPT_LEN < flat.length ? '…' : ''
  }`
}

/**
 * Rank index sections against `query`. Every token must appear somewhere in the
 * section (AND, not OR) so that multi-word queries narrow rather than widen.
 */
export function searchIndex(
  index: NextraIndex,
  query: string,
  limit = 8
): Hit[] {
  const phrase = query.toLowerCase().trim()
  const tokens = phrase.split(/\s+/).filter(Boolean)
  if (!tokens.length) return []

  const hits: Hit[] = []

  for (const [route, page] of Object.entries(index)) {
    const title = page?.title || route
    const lowerTitle = title.toLowerCase()

    for (const [key, rawContent] of Object.entries(page?.data ?? {})) {
      const [anchor, headingText] = key.split('#')
      const heading = headingText ?? ''
      const content = rawContent ?? ''
      const lowerHeading = heading.toLowerCase()
      const lowerContent = content.toLowerCase()

      let score = 0
      let matchesEveryToken = true
      for (const token of tokens) {
        const inTitle = lowerTitle.includes(token)
        const inHeading = lowerHeading.includes(token)
        const inContent = lowerContent.includes(token)
        if (!inTitle && !inHeading && !inContent) {
          matchesEveryToken = false
          break
        }
        score += (inTitle ? 8 : 0) + (inHeading ? 4 : 0) + (inContent ? 1 : 0)
      }
      if (!matchesEveryToken) continue

      // Whole-phrase hits beat scattered-token hits.
      if (lowerTitle.includes(phrase)) score += 12
      if (lowerHeading.includes(phrase)) score += 6
      // The search lives in the docs; keep changelog/blog below reference pages.
      if (route.startsWith('/docs')) score += 3

      hits.push({
        href: anchor ? `${route}#${anchor}` : route,
        title,
        heading,
        excerpt: buildExcerpt(content, tokens),
        score,
      })
    }
  }

  // One entry per anchor already, but a page intro and its first section can
  // collapse onto the same href — keep the best-scoring one.
  const bestByHref = new Map<string, Hit>()
  for (const hit of hits.sort((a, b) => b.score - a.score)) {
    if (!bestByHref.has(hit.href)) bestByHref.set(hit.href, hit)
  }
  return Array.from(bestByHref.values()).slice(0, limit)
}
