import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type FooterLink = {
  name: string
  href: string
  external?: boolean
  comingSoon?: boolean
}

type FooterMenu = {
  title: string
  links: FooterLink[]
}

const FOOTER_MENUS: FooterMenu[] = [
  {
    title: 'Product',
    links: [
      {
        name: 'Jan Desktop',
        href: '/docs/desktop/quickstart',
      },
      { name: 'Jan Agent', href: '/docs/agent/quickstart' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { name: 'Docs', href: '/docs' },
      { name: 'Research', href: '/research' },
      { name: 'Blog', href: '/blog' },
      { name: 'Changelog', href: '/changelog' },
    ],
  },
  {
    title: 'Company',
    links: [
      { name: 'Careers', href: 'https://menlo.ai/careers', external: true },
    ],
  },
  {
    title: 'Connect',
    links: [
      { name: 'X', href: 'https://x.com/jandotai', external: true },
      {
        name: 'Discord',
        href: 'https://discord.com/invite/FTk2MvZwJH',
        external: true,
      },
      { name: 'GitHub', href: 'https://github.com/janhq/jan', external: true },
      {
        name: 'LinkedIn',
        href: 'https://www.linkedin.com/company/opensuperintelligence',
        external: true,
      },
    ],
  },
]

export default function Footer() {
  // Which sections are expanded on mobile. Desktop always shows every link
  // (the list is `lg:block`), so this only affects the mobile accordion.
  const [openSections, setOpenSections] = useState<string[]>([])

  const toggleSection = (title: string) => {
    setOpenSections((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    )
  }

  return (
    <footer className="py-4 w-full">
      <div className="nextra-wrap-container">
        {/* Columns: collapsible accordions on mobile, static columns on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-6 lg:gap-8">
          {FOOTER_MENUS.map((menu, index) => {
            const isOpen = openSections.includes(menu.title)
            const isLast = index === FOOTER_MENUS.length - 1
            return (
              <div
                key={menu.title}
                className={cn('lg:border-0', !isLast && 'border-b border-black/5')}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(menu.title)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between py-4 text-left lg:py-0 lg:mb-4 lg:cursor-default lg:pointer-events-none"
                >
                  <h3 className="text-base font-bold">{menu.title}</h3>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-gray-500 transition-transform lg:hidden',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>
                <ul
                  className={cn(
                    'space-y-2 lg:block lg:pb-0',
                    isOpen ? 'block pb-4' : 'hidden'
                  )}
                >
                  {menu.links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        className="text-base text-gray-600 hover:text-gray-900"
                        target={link.external ? '_blank' : undefined}
                        rel={link.external ? 'noopener noreferrer' : undefined}
                      >
                        {link.name}
                        {link.comingSoon && (
                          <span className="text-xs ml-2 bg-gray-200 border border-gray-300 px-1 py-0.5 rounded-3xl">
                            Coming Soon
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {/* Jan Logo — first on mobile (brand → nav → legal), right column on desktop */}
          <div className="order-first mb-6 lg:order-none lg:mb-0 lg:col-span-2 lg:text-right">
            <h2 className="text-[52px] font-bold leading-none">Jan</h2>
          </div>
        </div>

        <div className="mt-12 border-t border-black/5 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-gray-600">
          <p>
            Built with ♡ by{' '}
            <a
              href="https://menlo.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-900 underline-offset-2 hover:underline"
            >
              Menlo Research
            </a>
          </p>
          <p>© 2026 All rights reserved</p>
        </div>
      </div>
    </footer>
  )
}
