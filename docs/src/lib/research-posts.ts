export type Post = {
  slug: string
  title: string
  description: string
  tags: string[]
  cover: string
  date: string | null
}

export const POSTS: Post[] = [
  {
    slug: 'jan-v3-5-4b',
    title: 'Jan-v3.5-4B',
    description:
      'The first Jan personality — a 4B model fine-tuned for math reasoning with a distinct conversational identity.',
    tags: ['personality', 'reasoning', 'vision'],
    cover: '/assets/images/research/jan-v3-5-4b-banner.png',
    date: '2026-03-20',
  },
  {
    slug: 'jan-code-4b',
    title: 'Jan-Code-4B',
    description:
      'Lightweight 4B code-tuned model for fast local coding assistance and agentic workflows.',
    tags: ['code', 'vision'],
    cover: '/assets/images/research/jan-code-4b.png',
    date: '2026-03-02',
  },
  {
    slug: 'jan-v3-4b',
    title: 'Jan-v3-4B',
    description:
      '4B parameter instruct model distilled from a larger teacher, optimized as a fine-tuning base.',
    tags: ['instruct', 'vision'],
    cover: '/assets/images/research/jan-v3-4b.png',
    date: '2026-01-19',
  },
  {
    slug: 'jan-v2-vl',
    title: 'Jan-v2-VL',
    description:
      '8B vision-language model for long-horizon agentic automation in real software environments.',
    tags: ['vision', 'reasoning'],
    cover: '/assets/images/research/jan-v2-vl.png',
    date: '2025-11-06',
  },
  {
    slug: 'jan-v1',
    title: 'Jan-v1',
    description:
      '4B parameter model with strong performance on reasoning benchmarks.',
    tags: ['reasoning'],
    cover: '/assets/images/research/jan-v1.png',
    date: '2025-08-08',
  },
  {
    slug: 'jan-nano-128',
    title: 'Jan Nano 128k',
    description:
      'Compact model with a 128k context window for long-document research and tool use.',
    tags: ['deep research', 'edge'],
    cover: '/assets/images/research/jan-nano-128.png',
    date: '2025-06-25',
  },
  {
    slug: 'jan-nano-32',
    title: 'Jan Nano 32k',
    description:
      'Compact 32k-context model for fast local research and tool calling.',
    tags: ['deep research', 'edge'],
    cover: '/assets/images/research/jan-nano-32.png',
    date: '2025-06-10',
  },
  {
    slug: 'lucy',
    title: 'Lucy',
    description: 'Compact 1.7B model optimized for web search with tool calling.',
    tags: ['edge', 'deep research', 'vision'],
    cover: '/assets/images/research/lucy.png',
    date: '2025-07-18',
  },
]

export const CATEGORIES = [
  'all',
  'reasoning',
  'instruct',
  'code',
  'vision',
  'deep research',
  'personality',
  'edge',
]

export function formatDate(date: string) {
  return new Date(date)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase()
}

export function getPost(title: string): Post | undefined {
  return POSTS.find((p) => p.title === title)
}
