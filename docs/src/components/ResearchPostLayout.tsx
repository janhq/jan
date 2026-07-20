import { ReactNode } from 'react'

interface ResearchPostLayoutProps {
  title: string
  date?: string
  readingTime?: string
  children: ReactNode
}

function formatDate(date?: string) {
  if (!date) return null
  return new Date(date)
    .toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    .toUpperCase()
}

const ResearchPostLayout = ({
  title,
  date,
  readingTime,
  children,
}: ResearchPostLayoutProps) => {
  const formatted = formatDate(date)

  return (
    <div className="nextra-wrap-container py-20">
      <a
        href="/research"
        className="text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
      >
        ← Research
      </a>

      <div className="max-w-[720px] mx-auto mt-8">
        <div className="flex items-center gap-3 text-xs font-medium text-black/40 dark:text-white/40 uppercase tracking-wide">
          {formatted && <span>{formatted}</span>}
          {formatted && readingTime && <span>·</span>}
          {readingTime && <span>{readingTime}</span>}
        </div>
        <h1 className="text-4xl lg:text-5xl !font-normal leading-tight mt-3 font-serif">
          {title}
        </h1>

        <article className="research-article mt-10">{children}</article>
      </div>

      <style jsx global>{`
        .research-article h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin-top: 2.5rem;
          margin-bottom: 1rem;
        }
        .research-article h3 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 2rem;
          margin-bottom: 0.75rem;
        }
        .research-article p {
          margin-top: 1.25rem;
          line-height: 1.75;
        }
        .research-article a {
          color: #0668d5;
          text-decoration: underline;
        }
        .research-article ul,
        .research-article ol {
          margin-top: 1.25rem;
          padding-left: 1.5rem;
        }
        .research-article li {
          margin-top: 0.5rem;
        }
        .research-article ul {
          list-style: disc;
        }
        .research-article ol {
          list-style: decimal;
        }
        .research-article code {
          background: rgba(0, 0, 0, 0.05);
          border-radius: 0.25rem;
          padding: 0.1rem 0.35rem;
          font-size: 0.9em;
        }
        .research-article img {
          border-radius: 1rem;
          margin-top: 1.5rem;
        }
        .research-article table {
          margin-top: 1.5rem;
          border-collapse: collapse;
          width: 100%;
        }
        .research-article th,
        .research-article td {
          border: 1px solid rgba(0, 0, 0, 0.1);
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
      `}</style>
    </div>
  )
}

export default ResearchPostLayout
