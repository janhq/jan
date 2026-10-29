import { webSearch, webFetch } from '@janhq/tauri-plugin-websearch-api'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { TRUNCATION_MARKER } from '@/lib/toolPresentation'

export const WEB_TOOL_NAMES = new Set(['web_search', 'web_fetch'])

/**
 * How a call to a built-in web tool name is served. While web search is on the
 * built-in tools are what the model was offered, so they serve the call. While
 * it is off nothing is offered, so an MCP tool of the same name belongs to the
 * user and is an MCP call; with none, the call is refused rather than reaching
 * the provider the user switched off. Any other name is not a web tool.
 */
export function webToolRoute(
  toolName: string,
  webSearchEnabled: boolean,
  mcpToolNames: ReadonlySet<string>
): 'builtin' | 'disabled' | 'other' {
  if (!WEB_TOOL_NAMES.has(toolName)) return 'other'
  if (webSearchEnabled) return 'builtin'
  return mcpToolNames.has(toolName) ? 'other' : 'disabled'
}

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
 * The most characters a built-in web result may put into the conversation.
 *
 * A page enters history verbatim and stays there, so a page-sized one can
 * exhaust a small model's window on its own. It is held to what an MCP result
 * is held to: `contextCap`, the budget the model's window affords, and the
 * user's "Max tool output characters" setting - the tighter of the two, and no
 * cap at all when that setting is `0`, which means "keep results whole".
 * Without either, the websearch plugin's own bound still applies.
 */
export function webOutputCap(contextCap?: number): number | undefined {
  const configured = useMCPServers.getState().settings?.maxToolOutputChars
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return contextCap && contextCap > 0 ? contextCap : undefined
  }
  if (configured <= 0) return undefined
  return contextCap && contextCap > 0
    ? Math.min(contextCap, configured)
    : configured
}

/** `text` cut to `max` characters, without splitting a surrogate pair. */
function cutText(text: string, max: number): string {
  if (max <= 0) return ''
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * Execute a native web tool via the websearch plugin and shape web_search
 * output into the web-citation payload consumed by parseCitationsFromToolOutput.
 */
export async function executeWebTool(
  toolName: string,
  input: WebToolInput,
  options: { maxOutputChars?: number } = {}
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
      const cap = webOutputCap(options.maxOutputChars)
      let title = page.title
      let address = page.url
      let content = page.content
      let truncated = page.truncated
      const render = () =>
        `Title: ${title}\nURL: ${address}\n\n${content}${
          truncated ? TRUNCATION_MARKER : ''
        }`
      const headerLength = () => `Title: ${title}\nURL: ${address}\n\n`.length

      if (cap !== undefined && render().length > cap) {
        // Over budget: cut the page, and say so - the model reads the marker.
        truncated = true
        if (cap - headerLength() - TRUNCATION_MARKER.length < cap / 2) {
          // The title and url come from the page too, and here they would eat
          // the budget. The title is cut; a url that long is left out, because
          // a prefix of it is a different address, and a link built from it
          // would point somewhere else.
          const part = Math.floor(cap / 4)
          title = cutText(title, part)
          if (address.length > part) address = ''
        }
        content = cutText(
          content,
          cap - headerLength() - TRUNCATION_MARKER.length
        )
      }
      const text = render()
      // A budget too small for even the header and the marker: the cap still
      // holds, and what is left says the page was cut - as the whole marker
      // when it fits, which is the form `parseWebFetchOutput` recognises -
      // rather than showing a fragment of a title or an address.
      return {
        content:
          cap !== undefined && text.length > cap
            ? cap >= TRUNCATION_MARKER.length
              ? TRUNCATION_MARKER
              : cutText(TRUNCATION_MARKER.trimStart(), cap)
            : text,
      }
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
