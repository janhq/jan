'use client'
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { FaDiscord, FaGithub } from 'react-icons/fa'
import { FaXTwitter, FaLinkedinIn } from 'react-icons/fa6'
import { cn } from '@/lib/cn'
import { marketingUrl } from '@/lib/shared'
import { useDownloadLink } from '@/lib/use-download-link'
import { SearchField } from '@/components/search-field'

type MenuItem = {
  name: string
  href: string
  external?: boolean
  children?: { name: string; href: string; external?: boolean }[]
}

// Same menu as the old jan.ai/docs navbar. Docs links are local; marketing
// pages now live on jan.ai.
const MENU_ITEMS: MenuItem[] = [
  {
    name: 'Jan',
    href: '/desktop/quickstart',
    children: [
      { name: 'Jan Desktop', href: '/desktop/quickstart' },
      { name: 'Jan Agent', href: '/agent/quickstart' },
    ],
  },
  { name: 'Research', href: `${marketingUrl}/research` },
  { name: 'Docs', href: '/' },
  {
    name: 'Company',
    href: '#',
    children: [
      { name: 'Blog', href: `${marketingUrl}/blog` },
      { name: 'Careers', href: 'https://menlo.ai/careers', external: true },
    ],
  },
]

const SOCIALS = [
  { href: 'https://discord.com/invite/FTk2MvZwJH', Icon: FaDiscord, label: 'Discord' },
  { href: 'https://twitter.com/jandotai', Icon: FaXTwitter, label: 'X' },
  { href: 'https://github.com/janhq/jan', Icon: FaGithub, label: 'GitHub' },
  {
    href: 'https://linkedin.com/company/opensuperintelligence',
    Icon: FaLinkedinIn,
    label: 'LinkedIn',
  },
]

function Socials({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-4 text-black', className)}>
      {SOCIALS.map(({ href, Icon, label }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="rounded-lg flex items-center justify-center hover:opacity-70"
        >
          <Icon className="size-5" />
        </a>
      ))}
    </div>
  )
}

function DownloadJan({ className }: { className?: string }) {
  const downloadHref = useDownloadLink()
  return (
    <a
      href={downloadHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-black px-4 text-base font-medium text-white transition-colors hover:bg-black/85',
        className
      )}
    >
      Download Jan
    </a>
  )
}

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isDocsHome = pathname === '/'

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href

  return (
    <div
      id="navbar"
      className="sticky top-0 z-50 h-(--jan-nav-height) w-full border-b border-black/10 bg-white text-black lg:px-6"
    >
      <div className="jan-container flex h-full items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <img src="/assets/logo-jan.svg" alt="Jan" className="h-6 w-6" />
          <span className="text-xl font-bold">Jan</span>
        </a>

        <nav className="hidden lg:block">
          <ul className="flex items-center space-x-8">
            {MENU_ITEMS.map((item) => (
              <li
                key={item.name}
                className={cn(item.children && 'group relative py-2')}
              >
                <a
                  href={item.href}
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener noreferrer' : undefined}
                  className={cn(
                    'flex items-center gap-1 transition-opacity hover:opacity-70',
                    isActive(item.href) && 'font-semibold'
                  )}
                >
                  {item.name}
                  {item.children && (
                    <ChevronDown className="size-3.5 transition-transform duration-200 group-hover:rotate-180" />
                  )}
                </a>
                {item.children && (
                  <div className="invisible absolute left-0 top-full z-50 translate-y-1 pt-2 opacity-0 transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                    <div className="min-w-[180px] overflow-hidden rounded-xl border border-black bg-white shadow-[0px_4px_0px_0px_rgba(0,0,0,1)]">
                      {item.children.map((child) => (
                        <a
                          key={child.name}
                          href={child.href}
                          target={child.external ? '_blank' : undefined}
                          rel={child.external ? 'noopener noreferrer' : undefined}
                          className="block whitespace-nowrap px-4 py-2 text-black transition-colors hover:bg-jan-blue-soft hover:text-jan-blue"
                        >
                          {child.name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
            {/* The docs home has its own large search field. */}
            {!isDocsHome && (
              <li>
                <SearchField />
              </li>
            )}
            <li>
              <DownloadJan />
            </li>
            <li>
              <Socials />
            </li>
          </ul>
        </nav>

        <button
          className="flex h-8 w-8 flex-col items-center justify-center lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle mobile menu"
        >
          <span
            className={cn(
              'block h-0.5 w-6 bg-black transition-all duration-300',
              mobileOpen && 'translate-y-1.5 rotate-45'
            )}
          />
          <span
            className={cn(
              'mt-1 block h-0.5 w-6 bg-black transition-all duration-300',
              mobileOpen && 'opacity-0'
            )}
          />
          <span
            className={cn(
              'mt-1 block h-0.5 w-6 bg-black transition-all duration-300',
              mobileOpen && '-translate-y-1.5 -rotate-45'
            )}
          />
        </button>
      </div>

      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white lg:hidden">
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img src="/assets/logo-jan.svg" alt="Jan" className="h-6 w-6" />
                  <span className="text-2xl font-bold text-black">Jan</span>
                </div>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                >
                  ×
                </button>
              </div>
              <div className="mb-6">
                <SearchField variant="panel" onOpen={() => setMobileOpen(false)} />
              </div>
              <nav className="mb-6">
                <ul className="space-y-4">
                  {MENU_ITEMS.map((item) => (
                    <li key={item.name}>
                      <a
                        href={item.href}
                        className={cn(
                          'block py-2 text-lg font-medium text-black transition-colors hover:text-gray-600',
                          isActive(item.href) && 'font-bold text-blue-600'
                        )}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.name}
                      </a>
                      {item.children && (
                        <ul className="space-y-2 pl-4">
                          {item.children.map((child) => (
                            <li key={child.name}>
                              <a
                                href={child.href}
                                target={child.external ? '_blank' : undefined}
                                rel={child.external ? 'noopener noreferrer' : undefined}
                                className="block py-1 text-base text-gray-600 transition-colors hover:text-black"
                                onClick={() => setMobileOpen(false)}
                              >
                                {child.name}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
              <DownloadJan className="mb-6 w-full" />
              <Socials />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
