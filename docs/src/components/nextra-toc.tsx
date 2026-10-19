'use client'
/**
 * "On This Page" column ported from nextra-theme-docs 2.13 (src/components/toc.tsx)
 * so it looks and behaves as on jan.ai/docs:
 * - the headings (no title), regular weight; deeper levels hang off a thin
 *   guide line like a file tree
 * - active entry at full ink, the rest at 60%
 * - sticky footer under a divider: "Copy page"
 * Plugged into Fumadocs via DocsPage `slots.toc.main`; it reads the TOC and the
 * active heading from Fumadocs' TOC provider.
 */
import { useEffect, useRef } from 'react'
import { useActiveAnchor, useTOCItems } from 'fumadocs-ui/components/toc'
import { cn } from '@/lib/cn'
import { CopyPage } from '@/components/copy-page'

// h2 entries sit flush; deeper ones get a guide line on the left, nested
// one step further per level. Rows use padding, not margin, so the lines of
// neighbouring entries join into one.
const DEPTH_CLASS: Record<number, string> = {
  2: '',
  3: 'border-l pl-3',
  4: 'ml-3 border-l pl-3',
  5: 'ml-6 border-l pl-3',
  6: 'ml-9 border-l pl-3',
}

export function NextraToc() {
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
          <ul>
            {items.map((item) => {
              const id = item.url.slice(1)
              return (
                <li key={item.url} className="scroll-my-6 scroll-py-6">
                  <a
                    href={item.url}
                    className={cn(
                      DEPTH_CLASS[item.depth],
                      'inline-block w-full break-words py-1 transition-colors duration-150 ease-jan',
                      active === id
                        ? 'border-line text-ink'
                        : 'border-line text-ink/60 hover:text-ink'
                    )}
                  >
                    {item.title}
                  </a>
                </li>
              )
            })}
          </ul>
        )}
        <div
          className={cn(
            items.length > 0 &&
              'mt-8 border-t border-line bg-page pt-8 shadow-[0_-12px_16px_var(--color-page)]',
            'sticky bottom-0 flex flex-col items-start gap-2 pb-8'
          )}
        >
          <CopyPage variant="link" />
        </div>
      </div>
    </div>
  )
}
