'use client'
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import { useSearchContext } from 'fumadocs-ui/contexts/search'
import { cn } from '@/lib/cn'
import { ThemeToggle } from '@/components/theme-toggle'
import { marketingUrl } from '@/lib/shared'

// Docs navbar: wordmark and the two doc sets as tabs on the left; search and
// theme as bare icons, then Download, on the right. Below lg the tabs,
// theme and download fold into a menu panel under the bar.

type Tab = { label: string; href: string }

const TABS: Tab[] = [
  { label: 'Desktop', href: '/desktop' },
  { label: 'Agent', href: '/agent' },
]

const DOWNLOAD_URL = `${marketingUrl}/download`

/** "Jan" wordmark, as in jan.ai's navbar. Colour is baked into each SVG, so
 *  swap files per theme. Nudged up 1px: it sits a touch low against the tabs. */
function Logo() {
  return (
    <>
      <img src="/assets/brand/jan-wordmark.svg" alt="Jan" className="h-3.5 w-auto -translate-y-px dark:hidden" />
      <img
        src="/assets/brand/jan-wordmark-white.svg"
        alt="Jan"
        className="hidden h-3.5 w-auto -translate-y-px dark:block"
      />
    </>
  )
}

function SearchButton({ onOpen }: { onOpen?: () => void }) {
  const { setOpenSearch } = useSearchContext()
  return (
    <button
      type="button"
      aria-label="Search docs"
      onClick={() => {
        onOpen?.()
        setOpenSearch(true)
      }}
      className="focus-ring flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink/60 transition-colors duration-150 ease-jan hover:text-ink"
    >
      <Search className="size-[18px]" strokeWidth={1.75} />
    </button>
  )
}

/** jan.ai's solid button (sm): ink fill, Geist Mono uppercase label, 35px. */
function DownloadJan({ className }: { className?: string }) {
  return (
    <a
      href={DOWNLOAD_URL}
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

export function Navbar() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  // Close the menu on navigation, and lock page scroll while it is open.
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div
      id="navbar"
      className="sticky top-0 z-50 h-(--jan-nav-height) w-full border-b border-line bg-page text-ink"
    >
      <div className="jan-container relative flex h-full items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" aria-label="Jan Docs home" className="focus-ring flex items-center rounded-sm">
            <Logo />
          </Link>

          <nav aria-label="Documentation" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {TABS.map(({ label, href }) => {
                const active = isActive(href)
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'focus-ring flex items-center rounded-lg px-3 py-1 text-body-sm transition-colors duration-150 ease-jan',
                        active ? 'bg-surface text-ink' : 'text-ink/60 hover:text-ink'
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        </div>

        {/* Search and theme as bare icons, then Download at the far right */}
        <div className="flex items-center gap-1">
          {/* Phones: the page list button, rendered by DocsLayout on docs pages
              (components/sidebar-trigger.tsx) */}
          <span id="docs-sidebar-trigger" className="flex md:hidden empty:hidden" />
          <SearchButton />
          <ThemeToggle className="hidden lg:flex" />
          <DownloadJan className="ml-2 hidden lg:inline-flex" />

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="docs-menu"
            className="focus-ring relative flex size-11 items-center justify-center rounded-lg lg:hidden"
          >
            {/* Two lines that cross into an X */}
            <span
              className={cn(
                'absolute h-[1.5px] w-5 rounded-full bg-current transition-transform duration-300 ease-jan',
                menuOpen ? 'rotate-45' : '-translate-y-[4px]'
              )}
            />
            <span
              className={cn(
                'absolute h-[1.5px] w-5 rounded-full bg-current transition-transform duration-300 ease-jan',
                menuOpen ? '-rotate-45' : 'translate-y-[4px]'
              )}
            />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          id="docs-menu"
          className="fixed inset-x-0 bottom-0 top-(--jan-nav-height) z-50 overflow-y-auto bg-page lg:hidden"
        >
          <div className="jan-container flex flex-col gap-6 py-6">
            <nav aria-label="Documentation">
              <ul className="flex flex-col gap-1">
                {TABS.map(({ label, href }) => {
                  const active = isActive(href)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'focus-ring flex min-h-[44px] items-center rounded-lg px-3 text-body transition-colors duration-150 ease-jan',
                          active ? 'bg-surface text-ink' : 'text-ink/60 active:text-ink'
                        )}
                      >
                        {label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>
            <div className="flex items-center justify-between border-t border-line pt-6">
              <span className="text-body-sm text-ink/60">Theme</span>
              <ThemeToggle className="-mr-2" />
            </div>
            <DownloadJan className="h-11 w-full" />
          </div>
        </div>
      )}
    </div>
  )
}
