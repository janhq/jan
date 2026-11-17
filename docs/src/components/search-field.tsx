'use client'
import { Search as SearchIcon } from 'lucide-react'
import { useSearchContext } from 'fumadocs-ui/contexts/search'
import { cn } from '@/lib/cn'

// Search field: white with a 1px line (a raised surface fill in dark mode,
// so it still reads as a field on near-black), ⌘K hint. Opens the
// Fumadocs/Orama search dialog.
export function SearchField({
  variant = 'navbar',
  className,
  onOpen,
}: {
  variant?: 'navbar' | 'panel' | 'hero'
  className?: string
  onOpen?: () => void
}) {
  const { setOpenSearch } = useSearchContext()

  return (
    <button
      type="button"
      aria-label="Search documentation"
      onClick={() => {
        onOpen?.()
        setOpenSearch(true)
      }}
      className={cn(
        'relative flex items-center text-left',
        variant === 'navbar' ? 'h-[35px] w-56' : 'w-full',
        className
      )}
    >
      <SearchIcon className="absolute left-3 size-4 text-ink/40 pointer-events-none" />
      <span
        className={cn(
          'w-full border border-line bg-page pl-9 pr-12 text-doc-small text-ink/40 dark:bg-surface',
          'transition-colors hover:border-ink/25',
          variant === 'hero' ? 'rounded-lg py-3.5' : 'flex h-full items-center rounded-lg'
        )}
      >
        Search docs…
      </span>
      <kbd className="absolute right-2 hidden rounded-sm border border-line bg-surface px-1.5 py-0.5 dark:bg-page font-mono text-doc-label text-ink/40 sm:block">
        ⌘K
      </kbd>
    </button>
  )
}
