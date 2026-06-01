import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Publisher logo for a model, resolved from the Hugging Face author avatar.
 *
 * HF exposes the avatar via the author "overview" endpoint:
 *   GET https://huggingface.co/api/organizations/{author}/overview -> { avatarUrl }
 *   GET https://huggingface.co/api/users/{author}/overview         -> { avatarUrl }
 *
 * Results (including misses) are cached at module level so each author is
 * fetched only once per session. Falls back to the first letter on miss.
 *
 * Visuals follow model-card v12: a square frame with "air" inside — the avatar
 * is contained at ~82% so logos breathe instead of bleeding to the edges.
 */
const avatarCache = new Map<string, string | null>()

async function fetchAuthorAvatar(author: string): Promise<string | null> {
  if (avatarCache.has(author)) return avatarCache.get(author) ?? null

  // HF org/user API paths are case-sensitive, but the catalog `developer`
  // field is often capitalised (e.g. "Mradermacher" vs the real
  // "mradermacher"). Try the name as-is and lowercased across both endpoints.
  const names = Array.from(new Set([author, author.toLowerCase()]))
  for (const kind of ['organizations', 'users']) {
    for (const name of names) {
      try {
        const res = await fetch(
          `https://huggingface.co/api/${kind}/${name}/overview`
        )
        if (!res.ok) continue
        const data = await res.json()
        if (data?.avatarUrl) {
          avatarCache.set(author, data.avatarUrl)
          return data.avatarUrl
        }
      } catch {
        // network/parse error — try the next candidate, then fall back
      }
    }
  }
  avatarCache.set(author, null)
  return null
}

type ModelLogoProps = {
  author?: string
  name?: string
  className?: string
}

export function ModelLogo({ author, name, className }: ModelLogoProps) {
  const [url, setUrl] = useState<string | null>(
    author ? (avatarCache.get(author) ?? null) : null
  )

  useEffect(() => {
    let active = true
    if (author && !avatarCache.has(author)) {
      fetchAuthorAvatar(author).then((u) => {
        if (active) setUrl(u)
      })
    }
    return () => {
      active = false
    }
  }, [author])

  const letter = (author || name || '?').charAt(0).toUpperCase()

  return (
    <div
      className={cn(
        'size-10 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-secondary text-muted-foreground font-semibold text-sm border border-border',
        className
      )}
      title={author || ''}
    >
      {url ? (
        <img
          src={url}
          alt={author || ''}
          className="size-full object-cover rounded-md"
          onError={() => {
            // Avatar URL resolved but the image itself failed (404 / blocked /
            // empty default). Cache the miss and fall back to the letter so
            // WebKit doesn't render its broken-image placeholder.
            if (author) avatarCache.set(author, null)
            setUrl(null)
          }}
        />
      ) : (
        letter
      )}
    </div>
  )
}
