import { Button } from '@/components/ui/button'
import { FaDiscord, FaGithub } from 'react-icons/fa'

const PILLARS = [
  {
    title: 'Rust-native engine',
    description:
      'Agent loop, tools, permissions, skills, and context compaction, built directly into Jan rather than bolted on.',
  },
  {
    title: 'Runs anywhere',
    description:
      'A standalone distribution you can run on a VM, a container, or your terminal, independent of Jan Desktop.',
  },
  {
    title: 'Cowork UI',
    description:
      'A graphical front end for the same engine when you want a desktop experience instead of the terminal.',
  },
]

const JanAgent = () => {
  return (
    <div className="nextra-wrap-container py-20">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-6xl !font-normal leading-tight lg:leading-tight font-serif">
          Jan Agent
        </h1>
        <p className="text-xl mt-2 leading-relaxed text-black/60 dark:text-white/60">
          The core agent, distributed separately from Jan Desktop. Same open
          model ecosystem: choose your model, build your agent, run it
          yourself.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
          <a
            href="https://github.com/janhq/jan"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="xl">
              <FaGithub className="size-4" />
              Follow development
            </Button>
          </a>
          <a
            href="https://discord.com/invite/FTk2MvZwJH"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="xl" variant="outline">
              <FaDiscord className="size-4" />
              Join the discussion
            </Button>
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
    </div>
  )
}

export default JanAgent
