'use client'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { useMemo, type ReactNode } from 'react'
import type { SharedProps } from 'fumadocs-ui/contexts/search'
import SearchDialog from '@/components/search'
import { Analytics } from '@/components/analytics'
import type { SearchPage } from '@/lib/search-pages'

export function Provider({
  children,
  searchPages,
}: {
  children: ReactNode
  searchPages: SearchPage[]
}) {
  // Fumadocs' search options only take its own props, so hand the page list
  // to the dialog through a wrapper (stable, so the dialog doesn't remount).
  const Dialog = useMemo(
    () =>
      function JanSearch(props: SharedProps) {
        return <SearchDialog {...props} pages={searchPages} />
      },
    [searchPages]
  )

  return (
    <RootProvider
      search={{ SearchDialog: Dialog }}
      // Light and dark, following the visitor's system setting until they
      // pick one in the navbar.
      theme={{ defaultTheme: 'system', enableSystem: true, hotKey: false }}
    >
      <Analytics />
      {children}
    </RootProvider>
  )
}
