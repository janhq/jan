import { Button } from '@/components/ui/button'

const PILLARS = [
  {
    title: 'Router',
    description:
      'Switch between local and cloud models from one endpoint, without changing your agent code.',
  },
  {
    title: 'Fusion Model',
    description:
      'Tokamak-1, a fusion model that blends specialist models behind a single API.',
  },
  {
    title: 'Governance & Audit',
    description:
      'Policy controls and audit trails for every request your agents make, self-hosted on your infrastructure.',
  },
]

const Tokamak = () => {
  return (
    <div className="nextra-wrap-container py-20">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-6xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
          Tokamak
        </h1>
        <p className="text-xl mt-2 leading-relaxed text-black/60 dark:text-white/60">
          The org-level self-hosted AI backend. An open model ecosystem: choose
          your model, build your agent, run it yourself.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
          <a href="https://tokamak.sh/docs/" target="_blank" rel="noopener noreferrer">
            <Button size="xl">Read the docs</Button>
          </a>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mt-20 max-w-4xl mx-auto">
        {PILLARS.map((pillar) => (
          <div
            key={pillar.title}
            className="rounded-2xl border border-black/10 dark:border-white/10 p-6"
          >
            <h3 className="text-lg font-semibold">{pillar.title}</h3>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              {pillar.description}
            </p>
          </div>
        ))}
      </div>

      <div className="text-center mt-16 text-sm text-black/50 dark:text-white/50">
        Jan agents connect to Tokamak for model switching, governance, and
        audit. See{' '}
        <a
          href="https://tokamak.sh/docs/getting-started/coding-agents"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400"
        >
          Connect an agent
        </a>
        .
      </div>
    </div>
  )
}

export default Tokamak
