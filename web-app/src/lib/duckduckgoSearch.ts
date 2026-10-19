import type { MCPToolCallResult } from '@janhq/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { MCPServerConfig } from '@/hooks/useMCPServers'

export const DUCKDUCKGO_SERVER = 'DuckDuckGo'

// Keep in sync with DEFAULT_MCP_CONFIG. Existing user configuration wins.
export const DEFAULT_DUCKDUCKGO_CONFIG: MCPServerConfig = {
  command: 'uvx',
  args: [
    '--from',
    'duckduckgo-mcp-server[browser]==0.7.0',
    'duckduckgo-mcp-server',
    '--search-backend',
    'auto',
    '--fetch-backend',
    'auto',
  ],
  env: { DDG_REF_URL_THRESHOLD: '0' },
  active: false,
  capabilities: ['web'],
  description: 'Search the web and read pages with DuckDuckGo. No API key required.',
}

let starting: Promise<void> | undefined

async function ensureConnected() {
  const mcp = getServiceHub().mcp()
  if ((await mcp.getConnectedServers()).includes(DUCKDUCKGO_SERVER)) return
  // Concurrent tool calls must share one process startup. Retry on a later call
  // after a failed startup or a deliberate server disconnect.
  if (!starting) {
    starting = (async () => {
      const config = await mcp.getMCPConfig()
      await mcp.activateMCPServer(
        DUCKDUCKGO_SERVER,
        config.mcpServers?.[DUCKDUCKGO_SERVER] ?? DEFAULT_DUCKDUCKGO_CONFIG
      )
    })().finally(() => { starting = undefined })
  }
  await starting
}

function textContent(result: MCPToolCallResult): string {
  if (result.error) throw new Error(result.error)
  const text = result.content
    ?.filter((block) => !block.type || block.type === 'text')
    .map((block) => block.text)
    .join('\n') ?? ''
  if (!text.trim()) throw new Error('DuckDuckGo returned an empty response')
  if (/^\s*(?:error\b|an error\b)/i.test(text)) throw new Error(text)
  return text
}

function httpUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('DuckDuckGo returned a non-HTTP source URL')
  }
  return url.href
}

export async function executeDuckDuckGoTool(
  toolName: string,
  input: { query?: unknown; count?: unknown; url?: unknown },
  maxOutputChars = 40_000
): Promise<{ content?: unknown; error?: string }> {
  if (toolName !== 'web_search' && toolName !== 'web_fetch') {
    return { error: `Unknown web tool '${toolName}'` }
  }
  const budget = Number.isFinite(maxOutputChars)
    ? Math.max(1, Math.floor(maxOutputChars)) : 40_000
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  const url = typeof input.url === 'string' ? input.url : ''
  if (toolName === 'web_search' && !query) return { error: 'A search query is required' }
  // Validate before starting a process. The server also validates DNS and
  // redirects, including private-address restrictions.
  if (toolName === 'web_fetch') httpUrl(url)
  await ensureConnected()
  const mcp = getServiceHub().mcp()
  const call = async (name: string, args: object, limit = budget) => textContent(
    await mcp.callTool({
      serverName: DUCKDUCKGO_SERVER,
      toolName: name,
      arguments: args,
      maxOutputChars: limit,
    })
  )
  if (toolName === 'web_fetch') {
    const content = await call('fetch_content', {
      url, start_index: 0, max_length: budget, parse_mode: 'markdown',
    })
    const header = `Title: \nURL: ${url}\n\n`
    const rendered = header + content
    if (rendered.length <= budget) return { content: rendered }
    const marker = '\n\n[content truncated]'
    if (header.length + marker.length >= budget) {
      return { content: marker.trimStart().slice(0, budget) }
    }
    let body = content.slice(0, budget - header.length - marker.length)
    // Do not cut a UTF-16 surrogate pair at the output boundary.
    if (/[\uD800-\uDBFF]$/.test(body)) body = body.slice(0, -1)
    return { content: header + body + marker }
  }
  const count = typeof input.count === 'number' && Number.isFinite(input.count)
    ? Math.max(1, Math.min(20, Math.floor(input.count))) : 5
  const text = await call('search', { query, max_results: count })
  if (/^No results were found/i.test(text.trim())) {
    return { content: { kind: 'web', query, results: [], message: text } }
  }
  const results = []
  const blocks = text.split(/(?=^\s*\d+\. )/m)
  for (const block of blocks) {
    const title = block.match(/^\s*\d+\. (.+)$/m)?.[1]?.trim()
    let source = block.match(/^\s*URL:\s*(\S+)/m)?.[1]
    if (!title || !source) continue
    if (source.startsWith('ref://')) {
      source = (await call('expand_link', { token: source }, 16_384)).trim()
    }
    results.push({
      title,
      url: httpUrl(source),
      text: block.match(/^\s*Summary:\s*(.*)$/m)?.[1]?.trim() ?? '',
    })
    if (results.length >= count) break
  }
  if (!results.length) throw new Error('DuckDuckGo returned unrecognized search results')
  return { content: { kind: 'web', query, results } }
}
