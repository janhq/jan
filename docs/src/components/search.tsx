'use client'
import { useMemo } from 'react'
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogListItem,
  SearchDialogOverlay,
  type SearchItemType,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search'
import { useStaticSearch } from 'fumadocs-core/search/client'
import type { SearchPage } from '@/lib/search-pages'

// Shown before anything is typed: where most visitors are headed.
const SUGGESTED = [
  '/desktop/quickstart',
  '/agent/quickstart',
  '/desktop/mcp',
  '/desktop/api-server',
  '/desktop/troubleshooting',
]

// Results are pages only (no heading or text matches), at most this many.
const MAX_RESULTS = 5

/** Page row: section label, title, then the page's description on one line. */
function PageRow({ page }: { page: SearchPage }) {
  return (
    <div className="flex flex-col gap-0.5">
      {page.section && (
        <span className="font-mono text-mono-label uppercase text-ink/40">{page.section}</span>
      )}
      <span className="font-medium text-ink">{page.title}</span>
      {page.description && <span className="line-clamp-1 text-ink/60">{page.description}</span>}
    </div>
  )
}

// Orama index is pre-built at build time (/api/search) and loaded in the
// browser, so search works on the static export.
export default function JanSearchDialog({
  pages = [],
  ...props
}: SharedProps & { pages?: SearchPage[] }) {
  const search = useStaticSearch({})
  const results = useMemo(
    () => search.data?.items.filter((item) => item.type === 'page').slice(0, MAX_RESULTS),
    [search.data]
  )

  const byUrl = useMemo(() => new Map(pages.map((p) => [p.url, p])), [pages])
  const suggested = useMemo<SearchItemType[]>(
    () =>
      SUGGESTED.flatMap((url) => {
        const page = byUrl.get(url)
        return page ? [{ id: url, url, type: 'page' as const, content: page.title }] : []
      }),
    [byUrl]
  )

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput placeholder="Search docs…" />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList
          items={results}
          defaultItems={suggested}
          Item={(itemProps) => {
            // Page rows get their description; anything else keeps
            // Fumadocs' row.
            const page =
              itemProps.item.type === 'page' ? byUrl.get(itemProps.item.url.split('#')[0]) : undefined
            return (
              <SearchDialogListItem {...itemProps}>
                {page ? <PageRow page={page} /> : undefined}
              </SearchDialogListItem>
            )
          }}
        />
      </SearchDialogContent>
    </SearchDialog>
  )
}
