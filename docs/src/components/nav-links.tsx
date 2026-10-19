'use client'
/**
 * Previous / next links at the end of an article: a small "Previous" / "Next"
 * label over the page title, with a chevron outside on that side. Limited to
 * the current section (Jan Desktop or Jan Agent). Replaces Fumadocs'
 * description cards.
 */
import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTreeContext } from 'fumadocs-ui/contexts/tree'
import type * as PageTree from 'fumadocs-core/page-tree'
import { cn } from '@/lib/cn'

// Pages of one root section in sidebar order; hidden pages are not in the tree.
function flatten(node: PageTree.Root | PageTree.Folder, out: PageTree.Item[] = []) {
  if (node.type === 'folder' && node.index) out.push(node.index)
  for (const child of node.children) {
    if (child.type === 'page' && !child.external) out.push(child)
    else if (child.type === 'folder') flatten(child, out)
  }
  return out
}

export function NavLinks() {
  const pathname = usePathname()
  const { root } = useTreeContext()

  // `root` is the current section (the Jan Desktop / Jan Agent root folder).
  const { prev, next } = useMemo(() => {
    const list = flatten(root)
    const i = list.findIndex((p) => p.url === pathname)
    return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 ? list[i + 1] : undefined }
  }, [root, pathname])

  if (!prev && !next) return null
  return (
    <nav aria-label="More pages" className="not-prose mb-8 mt-16 flex items-start gap-4 print:hidden">
      {prev && <PageLink page={prev} side="prev" />}
      {next && <PageLink page={next} side="next" />}
    </nav>
  )
}

function PageLink({ page, side }: { page: PageTree.Item; side: 'prev' | 'next' }) {
  const Component = page.url.startsWith('/') && !page.url.startsWith('//') ? Link : 'a'
  const Chevron = side === 'prev' ? ChevronLeft : ChevronRight
  return (
    <Component
      href={page.url}
      className={cn(
        'group focus-ring flex max-w-[50%] items-end gap-2 rounded-sm [word-break:break-word]',
        side === 'next' && 'ml-auto flex-row-reverse text-right'
      )}
    >
      <Chevron
        aria-hidden
        className="mb-0.5 size-5 shrink-0 text-ink/40 transition-[color,transform] duration-150 ease-jan group-hover:text-ink"
        strokeWidth={1.75}
      />
      <span className="flex flex-col gap-1">
        <span className="text-caption text-ink/60">{side === 'prev' ? 'Previous' : 'Next'}</span>
        <span className="text-body text-ink transition-colors duration-150 ease-jan group-hover:text-link">
          {page.name}
        </span>
      </span>
    </Component>
  )
}
