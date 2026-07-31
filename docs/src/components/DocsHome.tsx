/* eslint-disable @next/next/no-img-element */
import { Computer, BrainCircuit, Search, Rocket, Bot, Share2 } from 'lucide-react'
import LogoJanSVG from '@/assets/icons/logo-jan.svg'

const SECTIONS = [
  {
    icon: Computer,
    title: 'Jan Desktop',
    description:
      'The cowork-style desktop app — chat, models, MCP connectors, and local API server.',
    tags: 'Quickstart · Models · CLI',
    href: '/docs/desktop',
    chip: 'bg-[#E0EEFE] text-[#0668D5]',
  },
  {
    icon: Bot,
    title: 'Jan Agent',
    description:
      'The standalone agent, distributed separately — launch autonomous coding agents against a local model.',
    tags: 'Coming soon',
    href: '/docs/agent',
    chip: 'bg-[#FDE68A]/60 text-[#92400E]',
  },
  {
    icon: BrainCircuit,
    title: 'Tokamak',
    description:
      'Self-hosted router, fusion model, and governance/audit. Jan agents connect here for model switching.',
    tags: 'Install · Connect an agent',
    href: 'https://tokamak.sh/docs/',
    external: true,
    chip: 'bg-[#C6E09E]/50 text-[#3F6212]',
  },
]

const COMMON_PATHS = [
  { icon: Rocket, title: 'Desktop Quickstart', href: '/docs/desktop/quickstart' },
  { icon: Bot, title: 'Jan Agent Quickstart', href: '/docs/agent/quickstart' },
  {
    icon: Share2,
    title: 'Tokamak install',
    href: 'https://tokamak.sh/docs/self-hosting/installation',
    external: true,
  },
]

const DocsHome = () => {
  return (
    <div className="nextra-wrap-container py-16 lg:py-24">
      <div className="text-center max-w-2xl mx-auto px-4">
        <h1 className="flex items-center justify-center gap-3 lg:gap-4 text-5xl lg:text-6xl !font-normal leading-none font-serif">
          <img
            src={LogoJanSVG.src}
            alt=""
            className="size-11 lg:size-14 animate-wave"
          />
          Jan Docs
        </h1>
        <p className="text-lg mt-5 leading-relaxed text-black/60 dark:text-white/60">
          References for Jan Desktop, Jan Agent, and Tokamak.
        </p>

        <button
          type="button"
          className="mt-8 w-full max-w-xl mx-auto flex items-center gap-3 rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.06] px-4 py-3.5 text-black/40 dark:text-white/40 hover:border-black/25 dark:hover:border-white/25 hover:bg-black/[0.05] transition-all"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 text-left text-sm">Search docs...</span>
          <kbd className="text-[11px] font-medium px-1.5 py-0.5 rounded-md border border-black/15 dark:border-white/15 bg-white dark:bg-white/10">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-5 mt-16 lg:mt-20 max-w-4xl mx-auto px-4">
        {SECTIONS.map((section) => (
          <a
            key={section.title}
            href={section.href}
            target={section.external ? '_blank' : undefined}
            rel={section.external ? 'noopener noreferrer' : undefined}
            className="group flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-7 transition-all duration-200 hover:border-black hover:bg-white dark:hover:bg-white/[0.06] hover:shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5"
          >
            <span
              className={`inline-flex size-12 items-center justify-center rounded-xl ${section.chip}`}
            >
              <section.icon className="size-6" strokeWidth={2} />
            </span>
            <h3 className="text-xl font-semibold mt-5">{section.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-black/60 dark:text-white/60 flex-1">
              {section.description}
            </p>
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-black/[0.07] dark:border-white/[0.08]">
              <span className="text-xs text-black/40 dark:text-white/40">
                {section.tags}
              </span>
              <span className="inline-flex items-center gap-1 text-sm font-medium">
                Read docs
                <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                  →
                </span>
              </span>
            </div>
          </a>
        ))}
      </div>

      <div className="max-w-3xl mx-auto mt-16 lg:mt-20 px-4">
        <h2 className="text-xs font-semibold text-black/40 dark:text-white/40 uppercase tracking-widest">
          Common paths
        </h2>
        <div className="grid sm:grid-cols-3 gap-4 mt-5">
          {COMMON_PATHS.map((path) => (
            <a
              key={path.href}
              href={path.href}
              target={path.external ? '_blank' : undefined}
              rel={path.external ? 'noopener noreferrer' : undefined}
              className="group flex items-center gap-3 rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-4 text-sm font-medium transition-all duration-200 hover:border-black hover:bg-white dark:hover:bg-white/[0.06] hover:shadow-[0px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-white/10 border border-black/[0.07] dark:border-white/[0.08] text-black/60 dark:text-white/60">
                <path.icon className="size-4" strokeWidth={2} />
              </span>
              {path.title}
              <span
                aria-hidden
                className="ml-auto text-black/30 dark:text-white/30 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-black dark:group-hover:text-white"
              >
                →
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DocsHome
