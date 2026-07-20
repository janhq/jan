const POSTS = [
  {
    slug: 'jan-v1',
    title: 'Jan V1',
    description:
      'Agentic reasoning model in the Jan family, built for research and tool use.',
    date: '2025-08-22',
  },
  {
    slug: 'jan-v2',
    title: 'Jan V2',
    description: 'Model report — coming soon.',
    date: null,
  },
  {
    slug: 'jan-v3',
    title: 'Jan V3',
    description: 'Model report — coming soon.',
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
    <div className="nextra-wrap-container py-20">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-6xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
          Research
        </h1>
        <p className="text-xl mt-2 leading-relaxed text-black/60 dark:text-white/60">
          Model reports from the Jan family — what each model is, how it was
          trained and evaluated, and its limits.
        </p>
      </div>

      <div className="max-w-4xl mx-auto mt-16">
        {/* Featured post */}
        <a
          href={`/research/${featured.slug}`}
          className="block rounded-2xl border-2 border-black shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] p-8 hover:-translate-y-0.5 transition-transform"
        >
          {featured.date && (
            <p className="text-xs font-medium text-black/40 uppercase tracking-wide">
              {formatDate(featured.date)}
            </p>
          )}
          <h2 className="text-2xl lg:text-3xl font-semibold mt-2">
            {featured.title}
          </h2>
          <p className="mt-2 text-black/60">{featured.description}</p>
        </a>

        {/* Rest of the grid */}
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {rest.map((post) => (
            <a
              key={post.slug}
              href={`/research/${post.slug}`}
              className="rounded-2xl border border-black/10 dark:border-white/10 p-6 hover:border-black/30 dark:hover:border-white/30 transition-colors"
            >
              <h3 className="text-lg font-semibold">{post.title}</h3>
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                {post.description}
              </p>
              {post.date ? (
                <p className="mt-4 text-xs text-black/40 dark:text-white/40">
                  {formatDate(post.date)}
                </p>
              ) : (
                <p className="mt-4 text-xs text-black/40 dark:text-white/40 uppercase tracking-wide">
                  Coming soon
                </p>
              )}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Research
