import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import type { ReactNode } from 'react'
import { baseOptions } from '@/lib/layout.shared'
import { source } from '@/lib/source'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      // Jan Desktop / Jan Agent are root folders -> sidebar tab switcher.
      tabMode="auto"
      sidebar={{ defaultOpenLevel: 0, collapsible: false }}
    >
      {children}
    </DocsLayout>
  )
}
