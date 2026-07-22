import { webSearch, webFetch } from '@janhq/tauri-plugin-websearch-api'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'

export const WEB_TOOL_NAMES = new Set(['web_search', 'web_fetch'])

export const WEB_SEARCH_DESCRIPTION =
  'Search the web and return a ranked list of results (title, URL, snippet, and optional publish date). Use this to find current information, documentation, or sources you can then read with web_fetch. Cite the URLs you rely on.'

export const WEB_SEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'The search query.' },
    count: {
      type: 'integer',
      description: 'Maximum number of results to return (default 5, max 20).',
    },
  },
  required: ['query'],
} as const

export const WEB_FETCH_DESCRIPTION =
  'Fetch a web page by URL and return its readable text content along with the source URL and title. Output is bounded to avoid flooding the context. Use after web_search to read a specific result.'

export const WEB_FETCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The http(s) URL to fetch.' },
  },
  required: ['url'],
} as const

function faviconFor(url: string): string | undefined {
  try {
    const host = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return undefined
  }
}

type WebToolInput = { query?: unknown; count?: unknown; url?: unknown }
type WebToolResult = { content?: unknown; error?: string }

/**
 * Execute a native web tool via the websearch plugin and shape web_search
 * output into the web-citation payload consumed by parseCitationsFromToolOutput.
 */
export async function executeWebTool(
  toolName: string,
  input: WebToolInput
): Promise<WebToolResult> {
  const { apiKeys, endpoints, searchProvider } = useWebSearchConfig.getState()
  const apiKey = apiKeys[searchProvider] || undefined
  const endpoint = endpoints[searchProvider] || undefined
  try {
    if (toolName === 'web_search') {
      const query = typeof input?.query === 'string' ? input.query : ''
      const count = typeof input?.count === 'number' ? input.count : undefined
      const results = await webSearch(query, count, apiKey, searchProvider, endpoint)
      return {
        content: {
          kind: 'web',
          query,
          results: results.map((r) => ({
            url: r.url,
            title: r.title,
            text: r.snippet,
            published_date: r.published_at,
            favicon: faviconFor(r.url),
          })),
        },
      }
    }
    if (toolName === 'web_fetch') {
      const url = typeof input?.url === 'string' ? input.url : ''
      const page = await webFetch(url, apiKey, searchProvider, endpoint)
      const text = `Title: ${page.title}\nURL: ${page.url}\n\n${page.content}${
        page.truncated ? '\n\n[content truncated]' : ''
      }`
      return { content: text }
    }
    return { error: `Unknown web tool '${toolName}'` }
  } catch (e) {
    const message =
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e)
    return { error: message }
  }
}
