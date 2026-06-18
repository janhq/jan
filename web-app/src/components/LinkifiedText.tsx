import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Matches either a Markdown link `[label](https://…)` or a bare http(s) URL.
// Kept deliberately small: this renders short provider/error strings (e.g. the
// model-policy banner), not full Markdown — so we only need clickable links,
// not headings/lists/code/etc.
const LINK_PATTERN =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g

type LinkifiedTextProps = {
  /** Raw text that may contain Markdown links and/or bare URLs. */
  text: string
  /** Class applied to each rendered anchor. */
  linkClassName?: string
}

/**
 * Render plain text while turning Markdown links and bare URLs into clickable
 * anchors that open in the external browser (same `target="_blank"` pattern the
 * rest of the app uses).
 *
 * Why this exists: some banners (notably the model-policy error above the chat
 * input) just proxy the provider's error message, which can embed links like
 * `[Open dashboard](…)` or `[View agreement](…)`. Rendering the message as raw
 * text left those links dead; this makes them work without dragging the heavy
 * chat Markdown pipeline into an error banner.
 */
export function LinkifiedText({ text, linkClassName }: LinkifiedTextProps) {
  if (!text) return null

  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  LINK_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = LINK_PATTERN.exec(text)) !== null) {
    const [full, mdLabel, mdUrl, bareUrl] = match
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={key++}>{text.slice(lastIndex, match.index)}</Fragment>
      )
    }
    const url = mdUrl ?? bareUrl ?? ''
    const label = mdLabel ?? bareUrl ?? url
    nodes.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'text-primary underline underline-offset-2 hover:opacity-80 break-words',
          linkClassName
        )}
      >
        {label}
      </a>
    )
    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>)
  }

  return <>{nodes}</>
}
