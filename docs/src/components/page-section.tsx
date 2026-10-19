'use client'
import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useTreeContext } from 'fumadocs-ui/contexts/tree'
import type * as PageTree from 'fumadocs-core/page-tree'

// The sidebar section a page belongs to ("Get started", "Core concepts"…),
// shown above the page title in Geist Mono caps, in place of a breadcrumb.
// Pages inside a folder (Install > Mac) take the folder's section.

const contains = (node: PageTree.Node, url: string): boolean =>
  node.type === 'page'
    ? node.url === url
    : node.type === 'folder'
      ? node.index?.url === url || node.children.some((child) => contains(child, url))
      : false

export function PageSection() {
  const { root } = useTreeContext()
  const pathname = usePathname()

  const section = useMemo(() => {
    let current: PageTree.Separator | undefined
    for (const node of root.children) {
      if (node.type === 'separator') current = node
      else if (contains(node, pathname)) return current?.name
    }
  }, [root, pathname])

  if (!section) return null
  // mt-4: level with the first section label in the sidebar
  return <p className="mb-1 mt-4 font-mono text-mono-label uppercase text-ink/60">{section}</p>
}
