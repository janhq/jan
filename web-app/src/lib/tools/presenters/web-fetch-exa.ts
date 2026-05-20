import type { ToolPresentation } from '../types'

type FetchPageCard = {
  title: string
  url?: string
  domain?: string
  author?: string
  published?: string
  highlights: string[]
}

function parseExaTextEntry(text: string): FetchPageCard | undefined {
  const lines = text.split('\n').map((l) => l.trim())
  const titleLine = lines.find((l) => l.startsWith('Title:'))
  const urlLine = lines.find((l) => l.startsWith('URL:'))
  const publishedLine = lines.find((l) => l.startsWith('Published:'))
  const authorLine = lines.find((l) => l.startsWith('Author:'))

  const highlightsStart = lines.findIndex((l) => l.startsWith('Highlights:'))
  const highlights =
    highlightsStart >= 0
      ? lines
          .slice(highlightsStart + 1)
          .filter(Boolean)
          .filter((l) => l !== '[...]')
          .slice(0, 4)
      : []

  const url = urlLine?.replace(/^URL:\s*/, '')
  let domain: string | undefined

  try {
    if (url) domain = new URL(url).hostname
  } catch {
    domain = undefined
  }

  return {
    title: titleLine?.replace(/^Title:\s*/, '') ?? 'Untitled page',
    url,
    domain,
    published: publishedLine?.replace(/^Published:\s*/, ''),
    author: authorLine?.replace(/^Author:\s*/, ''),
    highlights,
  }
}

function isFetchPageCard(
  item: FetchPageCard | undefined
): item is FetchPageCard {
  return Boolean(item)
}

export function presentWebFetchExa(args: {
  input?: unknown
  output?: unknown
  errorText?: string
}): ToolPresentation {
  const urls =
    args.input &&
    typeof args.input === 'object' &&
    'urls' in (args.input as Record<string, unknown>) &&
    Array.isArray((args.input as Record<string, unknown>).urls)
      ? ((args.input as Record<string, unknown>).urls as string[])
      : []

  const items = Array.isArray(args.output) ? args.output : []
  const pages = items
    .filter(
      (item): item is { text?: string } =>
        !!item && typeof item === 'object' && 'text' in item
    )
    .map((item) => parseExaTextEntry(item.text ?? ''))
    .filter(isFetchPageCard)

  return {
    kind: 'web_fetch_exa',
    title: pages.length ? `Fetched ${pages.length} pages` : 'Fetched pages',
    subtitle: urls.length
      ? `${urls.length} URL${urls.length === 1 ? '' : 's'}`
      : undefined,
    urls,
    pages,
    rawInput: args.input,
    rawOutput: args.output,
    errorText: args.errorText,
  }
}
