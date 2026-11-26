import { forwardRef, type AnchorHTMLAttributes } from 'react'
import { externalHref, openExternalUrl } from '@/lib/externalLink'

export type ExternalAnchorProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href' | 'target' | 'rel'
> & { href?: string | null }

/**
 * A link to a URL the app does not control (search results, citations, model
 * cards, server-provided pages). A web or mail link opens outside the app; any
 * other href (`javascript:`, `file:`, app routes, ...) renders as inert text.
 */
export const ExternalAnchor = forwardRef<
  HTMLAnchorElement,
  ExternalAnchorProps
>(({ href, onClick, children, ...props }, ref) => {
  // Markdown renderers pass their own target="_blank" through; drop it (see
  // below).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { target: _target, ...rest } = props as typeof props & {
    target?: string
  }
  const external = externalHref(href)
  if (!external) {
    return (
      <a ref={ref} {...rest}>
        {children}
      </a>
    )
  }
  // No target="_blank": the click handler opens the URL itself, and WebKitGTK
  // still raises a new-window request for a _blank link whose click was
  // cancelled, which the navigation guard would hand to the browser a second
  // time.
  return (
    <a
      ref={ref}
      {...rest}
      href={external}
      rel="noopener noreferrer"
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        e.preventDefault()
        openExternalUrl(external)
      }}
    >
      {children}
    </a>
  )
})
ExternalAnchor.displayName = 'ExternalAnchor'
