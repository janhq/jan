const POSTS = [
  {
    slug: 'jan-v1',
    title: 'Jan V1',
    description:
      'Agentic reasoning model in the Jan family, built for research and tool use.',
    date: '2025-08-22',
  },
  {
    slug: 'jan-v3',
    title: 'Jan V3',
    description: 'Model report — coming soon.',
    date: null,
  },
  {
    slug: 'tokamak-1',
    title: 'Tokamak-1',
    description: 'The fusion model behind Tokamak — model report coming soon.',
    date: null,
  },
]

const Research = () => {
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

      <div className="grid md:grid-cols-3 gap-6 mt-16 max-w-4xl mx-auto">
        {POSTS.map((post) => (
          <a
            key={post.slug}
            href={`/research/${post.slug}`}
            className="rounded-2xl border border-black/10 dark:border-white/10 p-6 hover:border-black/30 dark:hover:border-white/30 transition-colors"
          >
            <h3 className="text-lg font-semibold">{post.title}</h3>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              {post.description}
            </p>
            {post.date && (
              <p className="mt-4 text-xs text-black/40 dark:text-white/40">
                {post.date}
              </p>
            )}
          </a>
        ))}
      </div>
    </div>
  )
}

export default Research
