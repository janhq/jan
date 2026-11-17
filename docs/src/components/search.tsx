'use client'
import { useMemo, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogList,
  SearchDialogListItem,
  SearchDialogOverlay,
  type SearchItemType,
  useSearch,
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
        <span className="font-mono text-doc-label uppercase text-ink/40">{page.section}</span>
      )}
      <span className="font-medium text-ink">{page.title}</span>
      {page.description && <span className="line-clamp-1 text-ink/60">{page.description}</span>}
    </div>
  )
}

/** Fumadocs' input with our placeholder (its own always says "Search").
 *  16px, so phones don't zoom in on focus. */
function SearchInput() {
  const { search, onSearchChange, getActive, subscribeActive } = useSearch()
  const active = useSyncExternalStore(subscribeActive, getActive, getActive)
  return (
    <input
      role="combobox"
      aria-label="Search docs"
      aria-expanded={active !== null}
      aria-activedescendant={active !== null ? `fd-search-option-${active}` : undefined}
      aria-autocomplete="list"
      aria-controls="fd-search-list"
      value={search}
      onChange={(e) => onSearchChange(e.target.value)}
      placeholder="Search docs…"
      className="w-0 flex-1 bg-transparent text-doc-h3 font-normal text-ink placeholder:text-ink/40 focus-visible:outline-none"
    />
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
      {/* Above the navbar (also z-50). On phones the box sits under the bar
          with the page's 20px gutters, and closes with an X instead of ESC. */}
      <SearchDialogOverlay className="z-[60]" />
      <SearchDialogContent className="z-[60] max-md:top-[calc(var(--jan-nav-height)+1rem)] max-md:w-[calc(100%-2.5rem)]">
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchInput />
          <SearchDialogClose
            className="max-md:size-9 max-md:border-0 max-md:p-0 max-md:text-ink/60 max-md:hover:text-ink"
          >
            <X aria-hidden className="size-[18px] md:hidden" strokeWidth={1.75} />
            <span className="max-md:hidden">ESC</span>
          </SearchDialogClose>
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
