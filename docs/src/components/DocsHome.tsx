/* eslint-disable @next/next/no-img-element */
import { Computer, BrainCircuit, Search, Rocket, Bot, Share2 } from 'lucide-react'
import LogoJanSVG from '@/assets/icons/logo-jan.svg'

const SECTIONS = [
  {
    icon: Computer,
    title: 'Jan',
    description:
      'Jan Desktop and Jan Agent — the cowork-style app and the standalone agent.',
    tags: 'Quickstart · Agents · CLI',
    href: '/docs/desktop',
  },
  {
    icon: BrainCircuit,
    title: 'Tokamak',
    description:
      'Self-hosted router, fusion model, and governance/audit. Jan agents connect here for model switching.',
    tags: 'Install · Connect an agent',
    href: 'https://tokamak.sh/docs/',
    external: true,
  },
]

const COMMON_PATHS = [
  { icon: Rocket, title: 'Quickstart', href: '/docs/desktop/quickstart' },
  { icon: Bot, title: 'Jan Agent', href: '/docs/desktop/agents' },
  {
    icon: Share2,
    title: 'Tokamak install',
    href: 'https://tokamak.sh/docs/self-hosting/installation',
    external: true,
  },
]

const DocsHome = () => {
  return (
    <div className="nextra-wrap-container py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 border border-black/15 dark:border-white/15 rounded-lg px-3 py-1.5">
          <img src={LogoJanSVG.src} alt="Jan" className="w-5 h-5" />
          <span className="font-semibold">Jan</span>
        </div>
        <h1 className="text-5xl !font-normal leading-tight mt-4 font-serif inline">
          {' '}Docs
        </h1>
        <p className="text-lg mt-4 leading-relaxed text-black/60 dark:text-white/60">
          References for Jan Desktop, Jan Agent, and Tokamak.
        </p>

        <button
          type="button"
          className="mt-8 w-full flex items-center gap-2 rounded-full border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.06] px-4 py-3 text-black/40 dark:text-white/40 hover:border-black/20 dark:hover:border-white/20 transition-colors"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left text-sm">Search docs...</span>
          <kbd className="text-xs px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-16 max-w-3xl mx-auto">
        {SECTIONS.map((section) => (
          <a
            key={section.title}
            href={section.href}
            target={section.external ? '_blank' : undefined}
            rel={section.external ? 'noopener noreferrer' : undefined}
            className="group flex flex-col rounded-2xl border border-black/10 dark:border-white/10 p-6 hover:border-black/30 dark:hover:border-white/30 transition-colors"
          >
            <section.icon className="size-7 text-[#458edf]" />
            <h3 className="text-lg font-semibold mt-4">{section.title}</h3>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60 flex-1">
              {section.description}
            </p>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-black/10 dark:border-white/10">
              <span className="text-xs text-black/40 dark:text-white/40">
                {section.tags}
              </span>
              <span className="text-xs font-medium group-hover:translate-x-0.5 transition-transform">
                Read docs →
              </span>
            </div>
          </a>
        ))}
      </div>

      <div className="max-w-3xl mx-auto mt-16">
        <h2 className="text-sm font-semibold text-black/40 dark:text-white/40 uppercase tracking-wide">
          Common paths
        </h2>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          {COMMON_PATHS.map((path) => (
            <a
              key={path.href}
              href={path.href}
              target={path.external ? '_blank' : undefined}
              rel={path.external ? 'noopener noreferrer' : undefined}
              className="flex flex-col gap-3 rounded-xl border border-black/10 dark:border-white/10 p-4 text-sm hover:border-black/30 dark:hover:border-white/30 transition-colors"
            >
              <path.icon className="size-5 text-black/50 dark:text-white/50" />
              {path.title}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DocsHome
