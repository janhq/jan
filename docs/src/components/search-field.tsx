'use client'
import { Search as SearchIcon } from 'lucide-react'
import { useSearchContext } from 'fumadocs-ui/contexts/search'
import { cn } from '@/lib/cn'

// Looks like the old DocSearch input (gray field, ⌘K hint) but opens the
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
        variant === 'navbar' ? 'w-56' : 'w-full',
        className
      )}
    >
      <SearchIcon className="absolute left-3 size-4 text-gray-400 pointer-events-none" />
      <span
        className={cn(
          'w-full border border-gray-200 bg-gray-50 pl-9 pr-12 text-sm text-gray-400',
          'transition-colors hover:border-gray-300 hover:bg-white',
          variant === 'hero' ? 'rounded-2xl py-3.5' : 'rounded-lg py-2'
        )}
      >
        Search docs…
      </span>
      <kbd className="absolute right-2 hidden rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:block">
        ⌘K
      </kbd>
    </button>
  )
}
