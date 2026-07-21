'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { fadeUp, staggerContainer, revealProps } from '@/lib/motion'

type Post = {
  slug: string
  title: string
  description: string
  category: string
  cover: string
  date: string | null
}

const POSTS: Post[] = [
  {
    slug: 'jan-v3-5-4b',
    title: 'Jan-v3.5-4B',
    description:
      'The first Jan personality — a 4B model fine-tuned for math reasoning with a distinct conversational identity.',
    category: 'reasoning',
    cover: '/assets/images/research/jan-v3-5-4b-banner.png',
    date: null,
  },
  {
    slug: 'jan-code-4b',
    title: 'Jan-Code-4B',
    description:
      'Lightweight 4B code-tuned model for fast local coding assistance and agentic workflows.',
    category: 'code',
    cover: '/assets/images/research/jan-code-4b.png',
    date: null,
  },
  {
    slug: 'jan-v3-4b',
    title: 'Jan-v3-4B',
    description:
      '4B parameter instruct model distilled from a larger teacher, optimized as a fine-tuning base.',
    category: 'language',
    cover: '/assets/images/research/jan-v3-4b.png',
    date: null,
  },
  {
    slug: 'jan-v2-vl',
    title: 'Jan-v2-VL',
    description:
      '8B vision-language model for long-horizon agentic automation in real software environments.',
    category: 'vision',
    cover: '/assets/images/research/jan-v2-vl.png',
    date: null,
  },
  {
    slug: 'jan-v1',
    title: 'Jan-v1',
    description:
      '4B parameter model with strong performance on reasoning benchmarks.',
    category: 'reasoning',
    cover: '/assets/images/research/jan-v1.png',
    date: '2025-08-22',
  },
  {
    slug: 'jan-nano-128',
    title: 'Jan Nano 128k',
    description:
      'Compact model with a 128k context window for long-document research and tool use.',
    category: 'compact',
    cover: '/assets/images/research/jan-nano-128.png',
    date: null,
  },
  {
    slug: 'jan-nano-32',
    title: 'Jan Nano 32k',
    description:
      'Compact 32k-context model for fast local research and tool calling.',
    category: 'compact',
    cover: '/assets/images/research/jan-nano-32.png',
    date: null,
  },
  {
    slug: 'lucy',
    title: 'Lucy',
    description: 'Compact 1.7B model optimized for web search with tool calling.',
    category: 'compact',
    cover: '/assets/images/research/lucy.png',
    date: null,
  },
]

const CATEGORIES = ['all', 'reasoning', 'language', 'code', 'vision', 'compact']

const INITIAL_COUNT = 7
const LOAD_MORE_COUNT = 6

function formatDate(date: string) {
  return new Date(date)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase()
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

function Meta({ post }: { post: Post }) {
  return (
    <div className="flex gap-3 text-xs font-medium uppercase tracking-widest">
      <span className="text-[#ff5c00]">{post.category}</span>
      {post.date && <span className="text-black/40 dark:text-white/40">{formatDate(post.date)}</span>}
    </div>
  )
}

function Cover({ post, className }: { post: Post; className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={post.cover}
        alt={post.title}
        loading="eager"
        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03]"
      />
    </div>
  )
}

const Research = () => {
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT)

  const filteredPosts = useMemo(
    () =>
      selectedCategory === 'all'
        ? POSTS
        : POSTS.filter((p) => p.category === selectedCategory),
    [selectedCategory]
  )

  const visiblePosts = filteredPosts.slice(0, visibleCount)
  const featured = visiblePosts[0]
  const gridPosts = visiblePosts.slice(1)
  const hasMore = visibleCount < filteredPosts.length

  const selectCategory = (cat: string) => {
    setSelectedCategory(cat)
    setVisibleCount(INITIAL_COUNT)
  }

  return (
    <div className="nextra-wrap-container mx-auto w-full max-w-[1400px] px-5 py-16 lg:px-10 lg:py-24">
      {/* ── Header: title + category pills ─────────────────────────────── */}
      <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-serif text-5xl !font-normal leading-none lg:text-7xl">
          Research
        </h1>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => selectCategory(cat)}
              className={`rounded-full px-4 py-2 text-xs font-medium uppercase tracking-widest transition-all ${
                selectedCategory === cat
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-black/40 hover:bg-black/[0.05] hover:text-black dark:text-white/40 dark:hover:bg-white/[0.06] dark:hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filteredPosts.length === 0 ? (
        <p className="mt-16 text-black/40 dark:text-white/40">
          No model reports in this category yet.
        </p>
      ) : (
        <div className="mt-12 flex flex-col gap-16 lg:mt-20 lg:gap-24">
          {/* ── Featured (above the fold, no reveal delay) ──────────────── */}
          {featured && (
            <a
              href={`/research/${featured.slug}`}
              className="group grid grid-cols-1 items-center gap-8 lg:grid-cols-2"
            >
              <Cover post={featured} className="aspect-[4/3]" />
              <div className="flex flex-col gap-4">
                <Meta post={featured} />
                <h2 className="font-serif text-3xl !font-normal leading-tight transition-opacity group-hover:opacity-70 lg:text-5xl">
                  {featured.title}
                </h2>
                <p className="text-lg leading-relaxed text-black/60 dark:text-white/60">
                  {featured.description}
                </p>
              </div>
            </a>
          )}

          {/* ── Grid: rows of 3, reveal on scroll ──────────────────────── */}
          {gridPosts.length > 0 && (
            <div className="flex flex-col gap-12 lg:gap-16">
              {chunk(gridPosts, 3).map((row, rowIndex) => (
                <motion.div
                  key={`${selectedCategory}-${rowIndex}`}
                  className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
                  variants={staggerContainer}
                  {...revealProps}
                >
                  {row.map((post) => (
                    <motion.a
                      key={post.slug}
                      href={`/research/${post.slug}`}
                      variants={fadeUp}
                      className="group flex flex-col gap-4"
                    >
                      <Cover post={post} className="aspect-[4/3]" />
                      <div className="flex flex-col gap-3">
                        <h3 className="text-xl font-semibold transition-opacity group-hover:opacity-70">
                          {post.title}
                        </h3>
                        <p className="text-sm leading-relaxed text-black/60 dark:text-white/60">
                          {post.description}
                        </p>
                        <Meta post={post} />
                      </div>
                    </motion.a>
                  ))}
                </motion.div>
              ))}
            </div>
          )}

          {/* ── Load more ──────────────────────────────────────────────── */}
          {hasMore && (
            <div className="flex justify-center">
              <button
                onClick={() => setVisibleCount((v) => v + LOAD_MORE_COUNT)}
                className="rounded-full border border-black/20 px-6 py-2.5 text-xs font-medium uppercase tracking-widest transition-colors hover:border-black hover:bg-black hover:text-white dark:border-white/20 dark:hover:border-white dark:hover:bg-white dark:hover:text-black"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Research
