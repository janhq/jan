'use client'
/**
 * Previous / next links at the end of an article, ported from
 * nextra-theme-docs 2.13 (NavLinks): title + chevron only, separated by a top
 * border, and limited to the current section (Jan Desktop or Jan Agent), as
 * Nextra's `isUnderCurrentDocsTree` did. Replaces Fumadocs' description cards.
 */
import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTreeContext } from 'fumadocs-ui/contexts/tree'
import type * as PageTree from 'fumadocs-core/page-tree'
import { cn } from '@/lib/cn'

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

const linkClass =
  'flex max-w-[50%] items-center gap-1 py-4 text-base font-medium text-[#4b5563] transition-colors [word-break:break-word] hover:text-jan-blue md:text-lg'

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
  const PrevLink = prev?.url.startsWith('/') && !prev.url.startsWith('//') ? Link : 'a'
  const NextLink = next?.url.startsWith('/') && !next.url.startsWith('//') ? Link : 'a'
  return (
    <div className="not-prose mb-8 mt-16 flex items-center border-t border-[#e5e7eb] pt-8 print:hidden">
      {prev && (
        <PrevLink href={prev.url} title={typeof prev.name === 'string' ? prev.name : undefined} className={cn(linkClass, 'pr-4')}>
          <ArrowRightIcon className="inline h-5 shrink-0 rotate-180" />
          {prev.name}
        </PrevLink>
      )}
      {next && (
        <NextLink href={next.url} title={typeof next.name === 'string' ? next.name : undefined} className={cn(linkClass, 'ml-auto pl-4 text-right')}>
          {next.name}
          <ArrowRightIcon className="inline h-5 shrink-0" />
        </NextLink>
      )}
    </div>
  )
}
