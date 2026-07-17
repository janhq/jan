import { Computer, BrainCircuit } from 'lucide-react'

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
    href: '/docs/tokamak',
  },
]

const COMMON_PATHS = [
  { title: 'Quickstart', href: '/docs/desktop/quickstart' },
  { title: 'Jan Agent', href: '/docs/desktop/agents' },
  { title: 'Tokamak install', href: '/docs/tokamak/install' },
]

const DocsHome = () => {
  return (
    <div className="nextra-wrap-container py-20">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-6xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
          Jan Docs
        </h1>
        <p className="text-xl mt-2 leading-relaxed text-black/60 dark:text-white/60">
          References for Jan Desktop, Jan Agent, and Tokamak.
        </p>
        <p className="text-sm mt-4 text-black/40 dark:text-white/40">
          Press <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20">⌘K</kbd> to search
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-16 max-w-3xl mx-auto">
        {SECTIONS.map((section) => (
          <a
            key={section.title}
            href={section.href}
            className="rounded-2xl border border-black/10 dark:border-white/10 p-6 hover:border-black/30 dark:hover:border-white/30 transition-colors"
          >
            <section.icon className="size-8" />
            <h3 className="text-lg font-semibold mt-4">{section.title}</h3>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              {section.description}
            </p>
            <p className="mt-4 text-xs text-black/40 dark:text-white/40">
              {section.tags}
            </p>
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
              className="rounded-xl border border-black/10 dark:border-white/10 p-4 text-sm hover:border-black/30 dark:hover:border-white/30 transition-colors"
            >
              {path.title}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DocsHome
