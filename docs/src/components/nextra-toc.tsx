'use client'
/**
 * "On This Page" column ported from nextra-theme-docs 2.13 (src/components/toc.tsx)
 * so it looks and behaves as on jan.ai/docs:
 * - title "On This Page", h2 entries semibold, deeper levels indented
 * - active entry in Jan blue, no indicator line
 * - sticky footer: feedback, edit on GitHub, View as Markdown, "Scroll to top"
 *   (hidden until the page is scrolled 300px)
 * Plugged into Fumadocs via DocsPage `slots.toc.main`; it reads the TOC and the
 * active heading from Fumadocs' TOC provider.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useActiveAnchor, useTOCItems } from 'fumadocs-ui/components/toc'
import { cn } from '@/lib/cn'

// Nextra's text-xs had an 18px line height (Tailwind 3 + its base styles).
const linkClassName = 'text-xs/[18px] font-medium text-[#6b7280] hover:text-[#111827]'

const DEPTH_CLASS: Record<number, string> = {
  2: 'font-semibold',
  3: 'pl-4',
  4: 'pl-8',
  5: 'pl-12',
  6: 'pl-16',
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

function BackToTop() {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const toggle = () =>
      ref.current?.classList.toggle('opacity-0', document.documentElement.scrollTop < 300)
    toggle()
    window.addEventListener('scroll', toggle)
    return () => window.removeEventListener('scroll', toggle)
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      aria-hidden="true"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn('flex items-center gap-1.5 opacity-0 transition', linkClassName)}
    >
      Scroll to top
      <ArrowRightIcon className="h-3.5 w-3.5 -rotate-90 rounded-full border border-current" />
    </button>
  )
}

export type NextraTocMeta = { title: string; editUrl: string; markdownUrl: string }

// Fumadocs renders slots.toc.main itself (with its own props), so the page
// metadata reaches it through context set by the page.
const TocMetaContext = createContext<NextraTocMeta>({ title: '', editUrl: '#', markdownUrl: '#' })

export function NextraTocMeta({ children, ...meta }: NextraTocMeta & { children: ReactNode }) {
  return <TocMetaContext value={meta}>{children}</TocMetaContext>
}

export function NextraToc() {
  const { title, editUrl, markdownUrl } = useContext(TocMetaContext)
  const items = useTOCItems().filter((item) => item.depth > 1)
  const active = useActiveAnchor()
  const tocRef = useRef<HTMLDivElement>(null)

  // Keep the active entry in view inside the scrollable column, as Nextra did.
  useEffect(() => {
    if (!active) return
    const anchor = tocRef.current?.querySelector<HTMLElement>(`li > a[href="#${CSS.escape(active)}"]`)
    const box = tocRef.current
    if (!anchor || !box) return
    const top = anchor.offsetTop - box.clientHeight / 2
    box.scrollTo({ top, behavior: 'smooth' })
  }, [active])

  const feedback = `https://github.com/janhq/jan/issues/new?title=${encodeURIComponent(
    `Feedback for “${title}”`
  )}&labels=feedback`

  return (
    <div
      id="nd-toc"
      className="nextra-toc sticky top-(--fd-docs-row-1) h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] [grid-area:toc] w-(--fd-toc-width) pe-4 xl:layout:[--fd-toc-width:256px] max-xl:hidden print:hidden"
    >
      <div
        ref={tocRef}
        className="max-h-full overflow-y-auto pl-4 pr-4 pt-6 text-sm/[21px] [hyphens:auto]"
      >
        {items.length > 0 && (
          <>
            <p className="mb-4 font-semibold tracking-tight text-black">On This Page</p>
            <ul>
              {items.map((item) => {
                const id = item.url.slice(1)
                return (
                  <li key={item.url} className="my-2 scroll-my-6 scroll-py-6">
                    <a
                      href={item.url}
                      className={cn(
                        DEPTH_CLASS[item.depth],
                        'inline-block w-full break-words',
                        active === id
                          ? 'text-[#006be6] subpixel-antialiased'
                          : 'text-[#6b7280] hover:text-[#111827]'
                      )}
                    >
                      {item.title}
                    </a>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <div
          className={cn(
            items.length > 0 &&
              'mt-8 border-t border-[#e5e7eb] bg-white pt-8 shadow-[0_-12px_16px_white]',
            'sticky bottom-0 flex flex-col items-start gap-2 pb-8'
          )}
        >
          <a href={feedback} target="_blank" rel="noreferrer" className={linkClassName}>
            Question? Give us feedback →
          </a>
          <a href={editUrl} target="_blank" rel="noreferrer" className={linkClassName}>
            Edit this page on GitHub →
          </a>
          <a href={markdownUrl} target="_blank" rel="noreferrer" className={linkClassName}>
            View as Markdown →
          </a>
          <BackToTop />
        </div>
      </div>
    </div>
  )
}
