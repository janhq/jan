import type { ToolPresentation } from '../types'

type SearchResultCard = {
  title: string
  url?: string
  domain?: string
  author?: string
  published?: string
  highlights: string[]
}

function parseExaTextEntry(text: string): SearchResultCard | undefined {
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
    title: titleLine?.replace(/^Title:\s*/, '') ?? 'Untitled result',
    url,
    domain,
    published: publishedLine?.replace(/^Published:\s*/, ''),
    author: authorLine?.replace(/^Author:\s*/, ''),
    highlights,
  }
}

function isSearchResultCard(
  item: SearchResultCard | undefined
): item is SearchResultCard {
  return Boolean(item)
}

export function presentWebSearchExa(args: {
  input?: unknown
  output?: unknown
  errorText?: string
}): ToolPresentation {
  const query =
    args.input &&
    typeof args.input === 'object' &&
    'query' in (args.input as Record<string, unknown>)
      ? String((args.input as Record<string, unknown>).query ?? '')
      : undefined

  const items = Array.isArray(args.output) ? args.output : []
  const results = items
    .filter(
      (item): item is { text?: string } =>
        !!item && typeof item === 'object' && 'text' in item
    )
    .map((item) => parseExaTextEntry(item.text ?? ''))
    .filter(isSearchResultCard)

  return {
    kind: 'web_search_exa',
    title: query ? `Searched: ${query}` : 'Web search',
    subtitle: results.length
      ? `${results.length} result${results.length === 1 ? '' : 's'}`
      : undefined,
    query,
    results,
    rawInput: args.input,
    rawOutput: args.output,
    errorText: args.errorText,
  }
}
