'use client'
import type { CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { marketingUrl } from '@/lib/shared'
import { ThemeToggle } from '@/components/theme-toggle'
import { SearchField } from '@/components/search-field'

// Pieces shared by the desktop navbar and the phone menu.

export const TABS = [
  { label: 'Desktop', href: '/desktop' },
  { label: 'Agent', href: '/agent' },
]

/** jan.ai's solid button (sm): ink fill, Geist Mono uppercase label, 35px. */
export function DownloadJan({ className }: { className?: string }) {
  return (
    <a
      href={`${marketingUrl}/download`}
      className={cn(
        'focus-ring inline-flex h-[35px] items-center justify-center whitespace-nowrap rounded-lg bg-ink px-4 py-2 font-mono text-mono-button uppercase text-page',
        'transition-[background-color,transform] duration-150 ease-jan hover:bg-ink/85 motion-safe:active:scale-[0.98]',
        className
      )}
    >
      Download
    </a>
  )
}

// Phone menu, top to bottom: the doc sets as tabs with the theme switch
// beside them, the search field, then (on doc pages) the section's page list,
// with Download pinned at the bottom. Same pieces as the desktop navbar, sized
// up to jan.ai's phone menu: 44px tap targets, bare icons at 60%.

/** Tabs + theme, then search. `onSearch` runs first (e.g. to close the menu). */
export function MobileMenuTop({ onSearch }: { onSearch?: () => void }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="jan-menu-row flex items-center justify-between gap-3" style={{ '--i': 0 } as CSSProperties}>
        <ul className="-ml-3 flex items-center gap-1">
          {TABS.map(({ label, href }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <li key={href}>
                <a
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'focus-ring flex h-11 items-center rounded-lg px-3 text-doc-h3 font-medium transition-colors duration-150 ease-jan',
                    active ? 'bg-surface text-ink' : 'text-ink/60 hover:text-ink'
                  )}
                >
                  {label}
                </a>
              </li>
            )
          })}
        </ul>
        <ThemeToggle className="-mr-2.5 size-11" />
      </div>
      <div className="jan-menu-row" style={{ '--i': 1 } as CSSProperties}>
        <SearchField variant="panel" className="h-11" onOpen={onSearch} />
      </div>
    </div>
  )
}

/** Download, full width, pinned under the list. */
export function MobileMenuFooter() {
  return (
    <div className="jan-menu-row" style={{ '--i': 3 } as CSSProperties}>
      <DownloadJan className="h-11 w-full" />
    </div>
  )
}
