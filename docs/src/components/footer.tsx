'use client'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { marketingUrl } from '@/lib/shared'

type FooterLink = { name: string; href: string; external?: boolean }
type FooterMenu = { title: string; links: FooterLink[] }

// Same columns as the old FooterMenu; marketing links now point to jan.ai.
const FOOTER_MENUS: FooterMenu[] = [
  {
    title: 'Product',
    links: [
      { name: 'Jan Desktop', href: '/desktop/quickstart' },
      { name: 'Jan Agent', href: '/agent/quickstart' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { name: 'Docs', href: '/' },
      { name: 'Research', href: `${marketingUrl}/research` },
      { name: 'Blog', href: `${marketingUrl}/blog` },
      { name: 'Changelog', href: `${marketingUrl}/changelog` },
    ],
  },
  {
    title: 'Company',
    links: [{ name: 'Careers', href: 'https://menlo.ai/careers', external: true }],
  },
  {
    title: 'Connect',
    links: [
      { name: 'X', href: 'https://x.com/jandotai', external: true },
      { name: 'Discord', href: 'https://discord.com/invite/FTk2MvZwJH', external: true },
      { name: 'GitHub', href: 'https://github.com/janhq/jan', external: true },
      {
        name: 'LinkedIn',
        href: 'https://www.linkedin.com/company/opensuperintelligence',
        external: true,
      },
    ],
  },
]

export function Footer() {
  const [openSections, setOpenSections] = useState<string[]>([])
  const toggle = (title: string) =>
    setOpenSections((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    )

  return (
    <footer className="w-full border-t border-black/5 bg-white py-12 text-[#4b5563]">
      {/* Old Nextra footer: 90rem container with 1.5rem + 1.5rem padding. */}
      <div className="jan-container jan-footer-inner">
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
                  onClick={() => toggle(menu.title)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between py-4 text-left lg:pointer-events-none lg:mb-4 lg:cursor-default lg:py-0"
                >
                  <h3 className="text-base font-bold">{menu.title}</h3>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-gray-500 transition-transform lg:hidden',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>
                <ul className={cn('space-y-2 lg:block lg:pb-0', isOpen ? 'block pb-4' : 'hidden')}>
                  {menu.links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        className="text-base hover:text-gray-900"
                        target={link.external ? '_blank' : undefined}
                        rel={link.external ? 'noopener noreferrer' : undefined}
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <div className="order-first mb-6 lg:order-none lg:col-span-2 lg:mb-0 lg:text-right">
            <h2 className="text-[52px] font-bold leading-none">Jan</h2>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-black/5 pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            Built with ♡ by{' '}
            <a
              href="https://menlo.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:text-gray-900 hover:underline"
            >
              Menlo Research
            </a>
          </p>
          <p>© {new Date().getFullYear()} All rights reserved</p>
        </div>
      </div>
    </footer>
  )
}
