import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { Search as SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SEARCH_INDEX_URL,
  searchIndex,
  type Hit,
  type NextraIndex,
} from './searchIndex'

// The index is only emitted by `next build`, so `next dev` has no file to fetch.
// A failed load hides the field entirely rather than leaving a box that silently
// returns nothing.
type IndexState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; index: NextraIndex }
  | { status: 'failed' }

let cachedIndex: NextraIndex | null = null

type DocSearchProps = {
  /** `navbar` is the inline desktop field; `panel` is the full-width mobile one. */
  variant?: 'navbar' | 'panel'
  className?: string
  /** Called after a result is picked, so the mobile menu can close itself. */
  onNavigate?: () => void
}

const DocSearch = ({
  variant = 'navbar',
  className,
  onNavigate,
}: DocSearchProps) => {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [state, setState] = useState<IndexState>(
    cachedIndex ? { status: 'ready', index: cachedIndex } : { status: 'idle' }
  )
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const loadIndex = () => {
    if (state.status !== 'idle') return
    setState({ status: 'loading' })
    fetch(SEARCH_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then((index: NextraIndex) => {
        cachedIndex = index
        setState({ status: 'ready', index })
      })
      .catch(() => setState({ status: 'failed' }))
  }

  // Derived, not stored: re-ranks the moment the index lands, so a query typed
  // while it was still downloading doesn't stay stuck on "No results".
  const hits = useMemo<Hit[]>(
    () =>
      state.status === 'ready' && query.trim()
        ? searchIndex(state.index, query)
        : [],
    [state, query]
  )

  useEffect(() => setActive(0), [query])

  // `/` and Cmd/Ctrl+K focus the field from anywhere on the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement
      const tag = el?.tagName.toLowerCase()
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (el as HTMLElement | null)?.isContentEditable
      )
        return
      if (e.key === '/' || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const go = (hit: Hit) => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    onNavigate?.()
    router.push(hit.href)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) go(hit)
    }
  }

  if (state.status === 'failed') return null

  const showPanel = open && query.trim().length > 0

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative',
        variant === 'navbar' ? 'w-56' : 'w-full',
        className
      )}
    >
      <div className="relative flex items-center">
        <SearchIcon className="absolute left-3 size-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder="Search docs…"
          aria-label="Search documentation"
          onFocus={() => {
            loadIndex()
            setOpen(true)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onInputKeyDown}
          className={cn(
            'w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-12',
            'text-sm text-black placeholder:text-gray-400',
            'transition-colors focus:border-gray-300 focus:bg-white focus:outline-none',
            '[&::-webkit-search-cancel-button]:appearance-none'
          )}
        />
        <kbd className="absolute right-2 hidden rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:block">
          ⌘K
        </kbd>
      </div>

      {showPanel && (
        <div
          data-doc-search-results=""
          className={cn(
            'absolute left-0 z-50 mt-2 max-h-[70vh] overflow-y-auto',
            'rounded-xl border border-gray-200 bg-white py-2 shadow-xl',
            // Widen past the input, but never past the viewport.
            variant === 'navbar'
              ? 'w-[34rem] max-w-[calc(100vw-3rem)]'
              : 'w-full'
          )}
        >
          {state.status === 'loading' && (
            <p className="px-4 py-3 text-sm text-gray-500">Loading…</p>
          )}

          {state.status === 'ready' && !hits.length && (
            <p className="px-4 py-3 text-sm text-gray-500">
              No results for “{query.trim()}”.
            </p>
          )}

          {hits.map((hit, i) => (
            <button
              key={hit.href}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
              className={cn(
                'block w-full px-4 py-2.5 text-left transition-colors',
                i === active ? 'bg-gray-100' : 'hover:bg-gray-50'
              )}
            >
              <span className="flex items-baseline gap-2">
                <span className="truncate text-sm font-semibold text-black">
                  {hit.heading || hit.title}
                </span>
                {hit.heading && (
                  <span className="truncate text-xs text-gray-400">
                    {hit.title}
                  </span>
                )}
              </span>
              {hit.excerpt && (
                <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-gray-500">
                  {hit.excerpt}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default DocSearch
