import { FlaskConical } from 'lucide-react'

const POSTS = [
  {
    slug: 'jan-v3-5-4b',
    title: 'Jan-v3.5-4B',
    description:
      'The first Jan personality — a 4B model fine-tuned for math reasoning with a distinct conversational identity.',
    date: null,
  },
  {
    slug: 'jan-code-4b',
    title: 'Jan-Code-4B',
    description:
      'Lightweight 4B code-tuned model for fast local coding assistance and agentic workflows.',
    date: null,
  },
  {
    slug: 'jan-v3-4b',
    title: 'Jan-v3-4B',
    description:
      '4B parameter instruct model distilled from a larger teacher, optimized as a fine-tuning base.',
    date: null,
  },
  {
    slug: 'jan-v2-vl',
    title: 'Jan-v2-VL',
    description:
      '8B vision-language model for long-horizon agentic automation in real software environments.',
    date: null,
  },
  {
    slug: 'jan-v1',
    title: 'Jan-v1',
    description:
      '4B parameter model with strong performance on reasoning benchmarks.',
    date: '2025-08-22',
  },
  {
    slug: 'jan-nano-128',
    title: 'Jan Nano 128k',
    description:
      'Compact model with a 128k context window for long-document research and tool use.',
    date: null,
  },
  {
    slug: 'jan-nano-32',
    title: 'Jan Nano 32k',
    description:
      'Compact 32k-context model for fast local research and tool calling.',
    date: null,
  },
  {
    slug: 'lucy',
    title: 'Lucy',
    description:
      'Compact 1.7B model optimized for web search with tool calling.',
    date: null,
  },
]

function formatDate(date: string) {
  return new Date(date)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase()
}

const Research = () => {
  const [featured, ...rest] = POSTS

  return (
    <div className="nextra-wrap-container py-16 lg:py-24">
      <div className="text-center max-w-2xl mx-auto px-4">
        <h1 className="text-5xl lg:text-6xl !font-normal leading-none font-serif">
          Research
        </h1>
        <p className="text-lg mt-5 leading-relaxed text-black/60 dark:text-white/60">
          Model reports from the Jan family: what each model is, how it was
          trained and evaluated, and its limits.
        </p>
      </div>

      <div className="max-w-3xl mx-auto mt-16 lg:mt-20 px-4">
        {/* Featured post */}
        <a
          href={`/research/${featured.slug}`}
          className="group block rounded-2xl border-2 border-black bg-white dark:bg-white/[0.03] shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] p-8 transition-transform duration-200 hover:-translate-y-0.5"
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#E0EEFE] text-[#0668D5]">
              <FlaskConical className="size-5" strokeWidth={2} />
            </span>
            {featured.date && (
              <span className="text-xs font-medium text-black/40 dark:text-white/40 uppercase tracking-widest">
                {formatDate(featured.date)}
              </span>
            )}
          </div>
          <h2 className="text-2xl lg:text-3xl font-semibold mt-5">
            {featured.title}
          </h2>
          <p className="mt-2 text-black/60 dark:text-white/60 leading-relaxed">
            {featured.description}
          </p>
          <div className="mt-6 pt-4 border-t border-black/[0.07] dark:border-white/[0.08]">
            <span className="inline-flex items-center gap-1 text-sm font-medium">
              Read report
              <span
                aria-hidden
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              >
                →
              </span>
            </span>
          </div>
        </a>

        {/* Rest of the grid */}
        <div className="grid md:grid-cols-2 gap-5 mt-5">
          {rest.map((post) => (
            <a
              key={post.slug}
              href={`/research/${post.slug}`}
              className="group flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-6 transition-all duration-200 hover:border-black hover:bg-white dark:hover:bg-white/[0.06] hover:shadow-[0px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5"
            >
              <h3 className="text-lg font-semibold">{post.title}</h3>
              <p className="mt-2 text-sm text-black/60 dark:text-white/60 flex-1">
                {post.description}
              </p>
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-black/[0.07] dark:border-white/[0.08]">
                <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-widest">
                  {post.date ? formatDate(post.date) : 'Coming soon'}
                </span>
                <span
                  aria-hidden
                  className="text-black/30 dark:text-white/30 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-black dark:group-hover:text-white"
                >
                  →
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Research
