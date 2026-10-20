import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { FaDiscord, FaGithub, FaLinkedinIn, FaXTwitter } from 'react-icons/fa6'
import type { IconType } from 'react-icons'
import { SearchField } from '@/components/search-field'
import { AgentDrawing, DesktopDrawing } from '@/components/home-drawings'

// docs.jan.ai landing page, short on purpose:
//   1. waving-hand title, intro and search
//   2. a tile per doc set: a picture (white line art of the product on a
//      jan.ai brand gradient), then its title and description in ink. On
//      hover the gradient slowly zooms and the drawing lifts.
//   3. "Start here": each set's most-read pages, under its tile
//   4. Jan's socials

type Section = {
  title: string
  description: string
  href: string
  drawing: ReactNode
  /** jan.ai brand gradient (public/images/home), behind the drawing only. */
  background: string
  /** Most-read pages, listed under "Start here". */
  links: { title: string; href: string }[]
}

const SECTIONS: Section[] = [
  {
    title: 'Jan Desktop',
    description:
      'The desktop app: chat, models, MCP connectors and the local API server.',
    href: '/desktop',
    drawing: <DesktopDrawing />,
    background: '/images/home/desktop.webp',
    links: [
      { title: 'Quickstart', href: '/desktop/quickstart' },
      { title: 'Install on Mac', href: '/desktop/install/mac' },
      { title: 'Local API Server', href: '/desktop/api-server' },
    ],
  },
  {
    title: 'Jan Agent',
    description:
      'The terminal agent: run coding tasks against a local or cloud model.',
    href: '/agent',
    drawing: <AgentDrawing />,
    background: '/images/home/agent.webp',
    links: [
      { title: 'Quickstart', href: '/agent/quickstart' },
      { title: 'CLI', href: '/agent/cli' },
      { title: 'Skills', href: '/agent/skills' },
    ],
  },
]

// Same accounts as jan.ai's menu.
const SOCIALS: { label: string; href: string; Icon: IconType }[] = [
  {
    label: 'Discord',
    href: 'https://discord.com/invite/FTk2MvZwJH',
    Icon: FaDiscord,
  },
  { label: 'X', href: 'https://x.com/jandotai', Icon: FaXTwitter },
  { label: 'GitHub', href: 'https://github.com/janhq/jan', Icon: FaGithub },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/opensuperintelligence',
    Icon: FaLinkedinIn,
  },
]

export function DocsHome() {
  return (
    <div className="jan-container py-16 lg:py-24">
      <div className="mx-auto max-w-5xl">
        {/* 1. Intro */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="flex items-center justify-center gap-3 text-doc-display text-ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/logo-jan.svg"
              alt=""
              className="size-[0.9em] motion-safe:animate-wave"
            />
            Jan Docs
          </h1>
          <p className="mt-3 text-doc-h3 font-normal text-ink/60">
            Everything you need to run Jan on your computer and in your terminal.
          </p>
          <SearchField variant="hero" className="mx-auto mt-8 max-w-xl" />
        </div>

        {/* 2. Doc sets */}
        <div className="mt-16 grid gap-x-4 gap-y-10 md:grid-cols-2 lg:mt-20">
          {SECTIONS.map(({ title, description, href, drawing, background }) => (
            <Link
              key={title}
              href={href}
              className="group focus-ring flex flex-col rounded-xl"
            >
              <div className="relative isolate flex items-center justify-center overflow-hidden rounded-xl px-8 py-10 sm:px-12 sm:py-14">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={background}
                  alt=""
                  className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-700 ease-jan motion-safe:group-hover:scale-110"
                />
                <div className="w-full max-w-[320px] transition-transform duration-500 ease-jan motion-safe:group-hover:-translate-y-1.5">
                  {drawing}
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-4">
                <h2 className="text-doc-h2 text-ink">{title}</h2>
                <ArrowRight
                  aria-hidden
                  className="size-5 shrink-0 text-ink/60 transition-[color,transform] duration-150 ease-jan group-hover:text-ink motion-safe:group-hover:translate-x-0.5"
                />
              </div>
              <p className="mt-1 text-doc-body text-ink/60">{description}</p>
            </Link>
          ))}
        </div>

        {/* 3. Start here: each set's most-read pages, in the tiles' columns */}
        <div className="mt-16 lg:mt-20">
          <h2 className="font-mono text-doc-label uppercase text-ink/60">
            Start here
          </h2>
          <div className="mt-6 grid gap-x-4 gap-y-8 md:grid-cols-2">
            {SECTIONS.map(({ title, links }) => (
              <div key={title}>
                <h3 className="mb-2 font-mono text-doc-label uppercase text-ink/40">
                  {title.replace('Jan ', '')}
                </h3>
                <ul className="border-t border-line">
                  {links.map((link) => (
                    <li key={link.href} className="border-b border-line">
                      <Link
                        href={link.href}
                        className="group focus-ring flex min-h-[52px] items-center gap-3 rounded-sm py-3"
                      >
                        <span className="text-doc-body text-ink/80 transition-colors duration-150 ease-jan group-hover:text-ink">
                          {link.title}
                        </span>
                        <ArrowRight className="ml-auto size-4 shrink-0 text-ink/40 transition-[color,transform] duration-150 ease-jan group-hover:text-ink motion-safe:group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Socials */}
        <div className="mt-16 flex flex-col items-center gap-3 lg:mt-20">
          <h2 className="font-mono text-doc-label uppercase text-ink/60">
            Join the community
          </h2>
          <ul className="flex gap-1">
            {SOCIALS.map(({ label, href, Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  title={label}
                  className="focus-ring flex size-11 items-center justify-center rounded-lg text-ink/60 transition-colors duration-150 ease-jan hover:text-ink"
                >
                  <Icon className="size-5" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
