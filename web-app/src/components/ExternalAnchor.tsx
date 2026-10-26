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
>(({ href, onClick, children, ...rest }, ref) => {
  const external = externalHref(href)
  if (!external) {
    return (
      <a ref={ref} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <a
      ref={ref}
      {...rest}
      href={external}
      target="_blank"
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
