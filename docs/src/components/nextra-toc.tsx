'use client'
/**
 * "On This Page" column ported from nextra-theme-docs 2.13 (src/components/toc.tsx)
 * so it looks and behaves as on jan.ai/docs:
 * - the headings (no title), doc-small; nested headings indent one step per
 *   level, and a thin line down the left follows the indents, stepping in and
 *   out on a short diagonal between levels
 * - the section you're reading: full ink, with a 2px ink stroke over its stretch
 *   of the line; the rest at 60%
 * - sticky footer under a divider: "Copy page"
 * Plugged into Fumadocs via DocsPage `slots.toc.main`; it reads the TOC and the
 * active heading from Fumadocs' TOC provider.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useActiveAnchor, useTOCItems } from 'fumadocs-ui/components/toc'
import { cn } from '@/lib/cn'
import { CopyPage } from '@/components/copy-page'

// Each level sits 12px further in; text starts 12px past its stretch of line.
const STEP = 12
const LEVEL_CLASS = ['pl-3', 'pl-6', 'pl-9', 'pl-12', 'pl-15']
const lineX = (level: number) => level * STEP + 0.5

/** Nesting level of each heading (0 = top): how many headings above it it
 *  sits under. Uses the heading tree, not raw h2/h3, so an h3 with no h2
 *  above it (a page that opens with <Steps>) sits at the top level instead of
 *  indenting, and the next h2 doesn't step back out past it. */
function levels(depths: number[]): number[] {
  const stack: number[] = []
  return depths.map((depth) => {
    while (stack.length && stack[stack.length - 1] >= depth) stack.pop()
    const level = stack.length
    stack.push(depth)
    return level
  })
}

type Track = { width: number; height: number; d: string; rows: { x: number; top: number; bottom: number }[] }

/** The line's path, measured from the rendered rows: a vertical run beside each
 *  row (inset by its 4px padding) and a diagonal from one row's end to the
 *  next row's start, so changes of level read as a step. */
function measure(list: HTMLElement, lvls: number[]): Track | null {
  const links = Array.from(list.querySelectorAll<HTMLAnchorElement>(':scope > li > a'))
  if (links.length === 0) return null
  const rows = links.map((a, i) => ({
    x: lineX(lvls[i]),
    top: a.offsetTop + 4,
    bottom: a.offsetTop + a.offsetHeight - 4,
  }))
  const d = rows
    .map((r, i) => (i === 0 ? `M${r.x} ${r.top}` : `L${r.x} ${r.top}`) + ` L${r.x} ${r.bottom}`)
    .join(' ')
  const width = Math.max(...rows.map((r) => r.x)) + 2
  return { width, height: list.offsetHeight, d, rows }
}

export function NextraToc() {
  const items = useTOCItems().filter((item) => item.depth > 1)
  const active = useActiveAnchor()
  const tocRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const activeIndex = items.findIndex((item) => item.url.slice(1) === active)

  // Draw the line once the rows are laid out, and again when they reflow
  // (wrapping titles, font load, resize).
  const itemLevels = levels(items.map((item) => item.depth))
  const levelKey = itemLevels.join(',')
  const redraw = useCallback(() => {
    if (listRef.current) setTrack(measure(listRef.current, levelKey.split(',').map(Number)))
  }, [levelKey])
  useLayoutEffect(() => {
    redraw()
    const list = listRef.current
    if (!list) return
    const observer = new ResizeObserver(redraw)
    observer.observe(list)
    return () => observer.disconnect()
  }, [redraw, items.length])

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
        className="max-h-full overflow-y-auto pl-4 pr-4 pt-6 text-doc-small [hyphens:auto]"
      >
        {items.length > 0 && (
          <div className="relative">
            {track && (
              <svg
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 overflow-visible"
                width={track.width}
                height={track.height}
              >
                <path d={track.d} fill="none" className="stroke-line" strokeWidth={1} />
                {activeIndex >= 0 && track.rows[activeIndex] && (
                  <path
                    d={`M${track.rows[activeIndex].x} ${track.rows[activeIndex].top - 4} L${track.rows[activeIndex].x} ${track.rows[activeIndex].bottom + 4}`}
                    fill="none"
                    className="stroke-ink transition-[d] duration-200 ease-jan"
                    strokeWidth={2}
                  />
                )}
              </svg>
            )}
            <ul ref={listRef}>
              {items.map((item, i) => {
                const id = item.url.slice(1)
                return (
                  <li key={item.url} className="scroll-my-6 scroll-py-6">
                    <a
                      href={item.url}
                      className={cn(
                        LEVEL_CLASS[Math.min(itemLevels[i], LEVEL_CLASS.length - 1)],
                        'block break-words py-1 transition-colors duration-150 ease-jan',
                        active === id ? 'text-ink' : 'text-ink/60 hover:text-ink'
                      )}
                    >
                      {item.title}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <div
          className={cn(
            items.length > 0 &&
              'mt-8 border-t border-line bg-page pt-8 shadow-[0_-12px_16px_var(--color-page)]',
            'sticky bottom-0 flex flex-col items-start gap-2 pb-8'
          )}
        >
          <CopyPage />
        </div>
      </div>
    </div>
  )
}
