'use client'
import { Fragment, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTreeContext, useTreePath } from 'fumadocs-ui/contexts/tree'
import { cn } from '@/lib/cn'

// Same breadcrumb as jan.ai/docs: "Docs > Jan Desktop > Install 👋 Jan > Linux".
// Folders without an index page are plain text; the current page is gray-700.
export function Breadcrumb() {
  const path = useTreePath()
  const { root } = useTreeContext()

  const items = useMemo(() => {
    const out: { name: React.ReactNode; url?: string }[] = [{ name: 'Docs', url: '/' }]
    for (const node of path) {
      if (node.type === 'folder') {
        out.push({ name: node.name, url: node.index?.url })
      } else if (node.type === 'page') {
        // A folder's index page is the folder itself ("Jan Desktop", not "Overview").
        const last = out[out.length - 1]
        if (last?.url === node.url) continue
        out.push({ name: node.name, url: node.url })
      }
    }
    return out
  }, [path, root])

  return (
    <div className="mt-1.5 flex items-center gap-1 overflow-hidden text-sm text-[#6b7280]">
      {items.map((item, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0" />}
            {item.url && !last ? (
              <a
                href={item.url}
                className="min-w-[24px] truncate transition-colors hover:text-[#111827]"
              >
                {item.name}
              </a>
            ) : (
              <span className={cn('truncate', last && 'font-medium text-[#374151]')}>
                {item.name}
              </span>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
