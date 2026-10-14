/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import { Bot, Computer, Rocket, type LucideIcon } from 'lucide-react'
import { SearchField } from '@/components/search-field'

// Port of the old DocsHome (jan.ai/docs), now the docs.jan.ai landing page.
type Section = {
  icon: LucideIcon
  title: string
  description: string
  tags: string
  href: string
  chip: string
}

const SECTIONS: Section[] = [
  {
    icon: Computer,
    title: 'Jan Desktop',
    description:
      'The cowork-style desktop app — chat, models, MCP connectors, and local API server.',
    tags: 'Quickstart · Models · CLI',
    href: '/desktop',
    chip: 'bg-[#E0EEFE] text-[#0668D5]',
  },
  {
    icon: Bot,
    title: 'Jan Agent',
    description:
      'The standalone agent, distributed separately — launch autonomous coding agents against a local model.',
    tags: 'Quickstart · Skills · Memory',
    href: '/agent',
    chip: 'bg-[#FDE68A]/60 text-[#92400E]',
  },
]

const COMMON_PATHS: { icon: LucideIcon; title: string; href: string }[] = [
  { icon: Rocket, title: 'Desktop Quickstart', href: '/desktop/quickstart' },
  { icon: Bot, title: 'Jan Agent Quickstart', href: '/agent/quickstart' },
]

export function DocsHome() {
  return (
    <div className="jan-container py-16 lg:py-24">
      <div className="mx-auto max-w-2xl px-4 text-center">
        <h1 className="flex items-center justify-center gap-3 font-serif text-5xl font-semibold leading-none lg:gap-4 lg:text-6xl">
          <img src="/assets/logo-jan.svg" alt="" className="size-11 animate-wave lg:size-14" />
          Jan Docs
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-black/60">
          References for Jan Desktop and Jan Agent.
        </p>
        <SearchField variant="hero" className="mx-auto mt-8 max-w-xl" />
      </div>

      <div className="mx-auto mt-16 grid max-w-3xl gap-5 px-4 md:grid-cols-2 lg:mt-20">
        {SECTIONS.map((section) => (
          <Link
            key={section.title}
            href={section.href}
            className="group flex flex-col rounded-2xl border border-black/10 bg-black/[0.02] p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-black hover:bg-white hover:shadow-[0px_4px_0px_0px_rgba(0,0,0,1)]"
          >
            <span
              className={`inline-flex size-12 items-center justify-center rounded-xl ${section.chip}`}
            >
              <section.icon className="size-6" strokeWidth={2} />
            </span>
            <h3 className="mt-5 text-xl font-semibold">{section.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-black/60">
              {section.description}
            </p>
            <div className="mt-6 flex items-center justify-between border-t border-black/[0.07] pt-4">
              <span className="text-xs text-black/40">{section.tags}</span>
              <span className="inline-flex items-center gap-1 text-sm font-medium">
                Read docs
                <span
                  aria-hidden
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-3xl px-4 lg:mt-20">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-black/40">
          Common paths
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {COMMON_PATHS.map((path) => (
            <Link
              key={path.href}
              href={path.href}
              className="group flex items-center gap-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:border-black hover:bg-white hover:shadow-[0px_3px_0px_0px_rgba(0,0,0,1)]"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-black/[0.07] bg-white text-black/60">
                <path.icon className="size-4" strokeWidth={2} />
              </span>
              {path.title}
              <span
                aria-hidden
                className="ml-auto text-black/30 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-black"
              >
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
