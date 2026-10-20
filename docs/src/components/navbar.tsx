'use client'
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import { useSearchContext } from 'fumadocs-ui/contexts/search'
import { cn } from '@/lib/cn'
import { ThemeToggle } from '@/components/theme-toggle'
import { MENU_BUTTON, MenuIcon } from '@/components/menu-icon'
import { DownloadJan, MobileMenuFooter, MobileMenuTop, TABS } from '@/components/mobile-menu'

// Docs navbar: wordmark and the two doc sets as tabs on the left, text only
// (the current one in full ink, the other at 60%; the phone menu's tabs keep
// a fill); search and theme as bare icons, then Download, on the right.
// Below lg the tabs, theme and download fold into a menu panel under the bar.

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

export function Navbar() {
  const pathname = usePathname()
  // The home menu stays on screen while 'closing' so it can roll back up
  // before it's removed (straight to 'closed' with reduced motion).
  const [menu, setMenu] = useState<'closed' | 'open' | 'closing'>('closed')
  const menuOpen = menu === 'open'
  const closeMenu = () =>
    setMenu((state) =>
      state !== 'open'
        ? state
        : window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'closed'
          : 'closing'
    )
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  // Close the menu on navigation, and lock page scroll while it is open.
  useEffect(() => setMenu('closed'), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
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
                        'focus-ring flex items-center rounded-lg px-3 py-1 text-doc-body font-medium transition-colors duration-150 ease-jan',
                        active ? 'text-ink' : 'text-ink/60 hover:text-ink'
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
          <SearchButton />
          <ThemeToggle className="hidden lg:flex" />
          <DownloadJan className="ml-2 hidden lg:inline-flex" />

          {/* Phones on doc pages: the menu button opens the page list instead
              (rendered here by DocsLayout, components/sidebar-trigger.tsx), and
              this one steps aside. */}
          <span id="docs-sidebar-trigger" className="peer flex empty:hidden md:hidden" />
          <button
            type="button"
            onClick={() => (menuOpen ? closeMenu() : setMenu('open'))}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="docs-menu"
            className={cn(MENU_BUTTON, 'lg:hidden max-md:peer-[:not(:empty)]:hidden')}
          >
            <MenuIcon open={menuOpen} />
          </button>
        </div>
      </div>

      {menu !== 'closed' && (
        <div
          id="docs-menu"
          className={cn(
            'jan-menu-panel fixed inset-x-0 bottom-0 top-(--jan-nav-height) z-50 overflow-y-auto bg-page lg:hidden',
            menu === 'closing' && 'jan-menu-panel--closing'
          )}
          onAnimationEnd={(e) => {
            if (menu === 'closing' && e.target === e.currentTarget) setMenu('closed')
          }}
        >
          <div className="jan-container flex min-h-full flex-col py-5">
            <MobileMenuTop onSearch={() => setMenu('closed')} />
            <div className="mt-auto border-t border-line pt-4">
              <MobileMenuFooter />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
