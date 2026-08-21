'use client'

import React, { ReactNode, useState } from 'react'
import { Link2, Check } from 'lucide-react'
import { POSTS, formatDate, getPost } from '@/lib/research-posts'

interface ResearchPostLayoutProps {
  title: string
  date?: string
  readingTime?: string
  children: ReactNode
}

// Approximate reading time from the rendered article text.
function childrenText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(childrenText).join(' ')
  if (React.isValidElement(node)) return childrenText((node.props as any)?.children)
  return ''
}

function TagChips({ tags }: { tags: string[] }) {
  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-md bg-[#E0EEFE] px-2 py-0.5 text-[#0668D5] dark:bg-[#0668D5]/15 dark:text-[#6ba6e8]"
        >
          {tag}
        </span>
      ))}
    </>
  )
}

function ShareButton() {
  const [copied, setCopied] = useState(false)
  const onShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }
  return (
    <button
      onClick={onShare}
      className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-black/50 transition-colors hover:text-black dark:text-white/50 dark:hover:text-white"
    >
      {copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
      {copied ? 'Copied' : 'Share'}
    </button>
  )
}

const ResearchPostLayout = ({
  title,
  date,
  readingTime,
  children,
}: ResearchPostLayoutProps) => {
  const post = getPost(title)
  const tags = post?.tags ?? []
  const isoDate = post?.date ?? date
  const formatted = isoDate ? formatDate(isoDate) : null

  const words = childrenText(children).trim().split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 200))
  const readTime = readingTime ?? `${minutes} min read`

  const keepReading = POSTS.filter((p) => p.title !== title).slice(0, 3)

  return (
    <div className="nextra-wrap-container py-20">
      <a
        href="/research"
        className="text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
      >
        ← Research
      </a>

      <div className="max-w-[720px] mx-auto mt-8">
        <h1 className="text-4xl lg:text-5xl !font-normal leading-tight font-serif">
          {title}
        </h1>

        {/* meta row: tags · date · reading time · share */}
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-black/[0.07] pt-5 dark:border-white/[0.08]">
          <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-widest">
            <TagChips tags={tags} />
            {formatted && <span className="text-black/40 dark:text-white/40">{formatted}</span>}
            {formatted && <span className="text-black/25 dark:text-white/25">·</span>}
            <span className="text-black/40 dark:text-white/40">{readTime}</span>
          </div>
          <ShareButton />
        </div>

        <article className="research-article mt-10">{children}</article>
      </div>

      {/* ── Keep reading ─────────────────────────────────────────────── */}
      {keepReading.length > 0 && (
        <div className="mx-auto mt-24 max-w-[1100px] border-t border-black/[0.07] pt-16 dark:border-white/[0.08]">
          <div className="flex items-end justify-between">
            <h2 className="font-serif text-3xl !font-normal lg:text-4xl">Keep reading</h2>
            <a
              href="/research"
              className="text-xs font-medium uppercase tracking-widest text-black/50 transition-colors hover:text-black dark:text-white/50 dark:hover:text-white"
            >
              View all →
            </a>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {keepReading.map((p) => (
              <a key={p.slug} href={`/research/${p.slug}`} className="group flex flex-col gap-4">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.cover}
                    alt={p.title}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <h3 className="text-lg font-semibold transition-opacity group-hover:opacity-70">
                    {p.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-widest">
                    <TagChips tags={p.tags} />
                    {p.date && <span className="text-black/40 dark:text-white/40">{formatDate(p.date)}</span>}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

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
        .research-article a:not(.not-prose) {
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
