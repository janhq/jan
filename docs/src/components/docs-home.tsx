import Link from 'next/link'
import { ArrowRight, Monitor, SquareTerminal, type LucideIcon } from 'lucide-react'
import { SearchField } from '@/components/search-field'

// docs.jan.ai landing page: doc-display title, a one-line intro, the hero
// search, a card per doc set, then the common starting
// points as a ruled list.
type Section = {
  icon: LucideIcon
  title: string
  description: string
  href: string
  chip: string
}

const SECTIONS: Section[] = [
  {
    icon: Monitor,
    title: 'Jan Desktop',
    description: 'The desktop app: chat, models, MCP connectors and the local API server.',
    href: '/desktop',
    chip: 'bg-jan-blue/15 text-jan-blue',
  },
  {
    icon: SquareTerminal,
    title: 'Jan Agent',
    description: 'The terminal agent: run coding tasks against a local or cloud model.',
    href: '/agent',
    chip: 'bg-jan-yellow/25 text-jan-neutral-950 dark:bg-jan-yellow/15 dark:text-jan-yellow',
  },
]

const COMMON_PATHS: { section: string; title: string; href: string }[] = [
  { section: 'Desktop', title: 'Quickstart', href: '/desktop/quickstart' },
  { section: 'Desktop', title: 'Install on Mac', href: '/desktop/install/mac' },
  { section: 'Desktop', title: 'Local API Server', href: '/desktop/api-server' },
  { section: 'Agent', title: 'Quickstart', href: '/agent/quickstart' },
  { section: 'Agent', title: 'CLI', href: '/agent/cli' },
  { section: 'Agent', title: 'Skills', href: '/agent/skills' },
]

export function DocsHome() {
  return (
    <div className="jan-container py-16 lg:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-doc-display text-ink">Jan Docs</h1>
        <p className="mt-3 text-doc-h3 font-normal text-ink/60">
          Guides and references for Jan Desktop and Jan Agent.
        </p>
        <SearchField variant="hero" className="mx-auto mt-8 max-w-xl" />
      </div>

      <div className="mx-auto mt-16 grid max-w-3xl gap-4 md:grid-cols-2 lg:mt-20">
        {SECTIONS.map(({ icon: Icon, title, description, href, chip }) => (
          <Link
            key={title}
            href={href}
            className="group focus-ring flex flex-col rounded-xl border border-line bg-page p-7 transition-colors duration-150 ease-jan hover:bg-surface"
          >
            <span className={`inline-flex size-11 items-center justify-center rounded-full ${chip}`}>
              <Icon className="size-5" strokeWidth={2} />
            </span>
            <h2 className="mt-6 text-doc-h2 text-ink">{title}</h2>
            <p className="mt-2 flex-1 text-doc-body text-ink/60">{description}</p>
            <span className="mt-6 inline-flex items-center gap-1.5 text-doc-small font-medium text-ink">
              Read the docs
              <ArrowRight className="size-3.5 transition-transform duration-150 ease-jan motion-safe:group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-3xl lg:mt-20">
        <h2 className="font-mono text-doc-label uppercase text-ink/60">Start here</h2>
        <ul className="mt-4 grid border-t border-line sm:grid-cols-2 sm:gap-x-8">
          {COMMON_PATHS.map(({ section, title, href }) => (
            <li key={href} className="border-b border-line">
              <Link
                href={href}
                className="group focus-ring flex min-h-[52px] items-center gap-3 rounded-sm py-3 transition-colors duration-150 ease-jan"
              >
                <span className="w-16 shrink-0 font-mono text-doc-label uppercase text-ink/40">
                  {section}
                </span>
                <span className="text-doc-body text-ink/80 transition-colors duration-150 ease-jan group-hover:text-ink">
                  {title}
                </span>
                <ArrowRight className="ml-auto size-4 shrink-0 text-ink/40 transition-[color,transform] duration-150 ease-jan group-hover:text-ink motion-safe:group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
