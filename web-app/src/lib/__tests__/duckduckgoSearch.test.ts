import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mcp, native } = vi.hoisted(() => ({
  mcp: {
    getConnectedServers: vi.fn(), getMCPConfig: vi.fn(),
    activateMCPServer: vi.fn(), callTool: vi.fn(),
  },
  native: { webSearch: vi.fn(), webFetch: vi.fn() },
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ mcp: () => mcp }),
}))
vi.mock('@janhq/tauri-plugin-websearch-api', () => native)

import { executeWebTool } from '../webSearchTool'
import { DEFAULT_DUCKDUCKGO_CONFIG, executeDuckDuckGoTool } from '../duckduckgoSearch'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { parseWebFetchOutput } from '../toolPresentation'
import { parseCitationsFromToolOutput } from '../citation-parser'

const result = (text: string) => ({ error: '', content: [{ type: 'text', text }] })
const searchText = 'Found 1 search results:\n\n1. Jan\n   URL: https://jan.ai/\n   Summary: Local AI\n'

describe('web search providers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useWebSearchConfig.setState({
      searchProvider: 'duckduckgo', webSearchEnabled: true, apiKeys: {}, endpoints: {},
    })
    mcp.getConnectedServers.mockResolvedValue(['DuckDuckGo'])
    mcp.getMCPConfig.mockResolvedValue({ mcpServers: {} })
    mcp.activateMCPServer.mockResolvedValue(undefined)
    mcp.callTool.mockResolvedValue(result(searchText))
  })

  it('reuses a connected server and returns clickable citations', async () => {
    const output = await executeWebTool('web_search', { query: 'Jan' })
    expect(output).toEqual({
      content: { kind: 'web', query: 'Jan', results: [{
        title: 'Jan', url: 'https://jan.ai/', text: 'Local AI',
      }] },
    })
    expect(parseCitationsFromToolOutput(output.content)).toMatchObject({ kind: 'web', citations: [{ url: 'https://jan.ai/' }] })
    expect(mcp.activateMCPServer).not.toHaveBeenCalled()
    expect(mcp.callTool).toHaveBeenCalledWith(expect.objectContaining({
      arguments: { query: 'Jan', max_results: 5 }, serverName: 'DuckDuckGo',
    }))
    expect(native.webSearch).not.toHaveBeenCalled()
  })

  it('starts the pinned built-in plugin only when needed', async () => {
    mcp.getConnectedServers.mockResolvedValue([])
    await executeWebTool('web_search', { query: 'Jan' })
    expect(mcp.activateMCPServer).toHaveBeenCalledWith('DuckDuckGo', DEFAULT_DUCKDUCKGO_CONFIG)
  })

  it('preserves custom configuration, region, and credentials', async () => {
    mcp.getConnectedServers.mockResolvedValue([])
    const config = { command: 'custom', args: [], env: { DDG_REGION: 'fr-fr' } }
    mcp.getMCPConfig.mockResolvedValue({ mcpServers: { DuckDuckGo: config } })
    await executeWebTool('web_search', { query: 'Jan' })
    expect(mcp.activateMCPServer).toHaveBeenCalledWith('DuckDuckGo', config)
  })

  it('shares startup across concurrent calls', async () => {
    mcp.getConnectedServers.mockResolvedValue([])
    let release!: () => void
    mcp.activateMCPServer.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const calls = [executeWebTool('web_search', { query: 'a' }), executeWebTool('web_search', { query: 'b' })]
    await vi.waitFor(() => expect(mcp.activateMCPServer).toHaveBeenCalledTimes(1))
    release()
    await Promise.all(calls)
  })

  it('allows retry after startup fails', async () => {
    mcp.getConnectedServers.mockResolvedValue([])
    mcp.activateMCPServer.mockRejectedValueOnce(new Error('offline'))
    expect(await executeWebTool('web_search', { query: 'a' })).toEqual({ error: 'offline' })
    expect(await executeWebTool('web_search', { query: 'a' })).toHaveProperty('content')
    expect(mcp.activateMCPServer).toHaveBeenCalledTimes(2)
  })

  it('expands shortened links before publishing citations', async () => {
    mcp.callTool.mockResolvedValueOnce(result(searchText.replace('https://jan.ai/', 'ref://123 (shortened)')))
      .mockResolvedValueOnce(result('https://jan.ai/long-page'))
    const output = await executeWebTool('web_search', { query: 'a' })
    expect(output).toMatchObject({ content: { results: [{ url: 'https://jan.ai/long-page' }] } })
    expect(mcp.callTool).toHaveBeenLastCalledWith(expect.objectContaining({
      toolName: 'expand_link', arguments: { token: 'ref://123' },
    }))
  })

  it('rejects unsafe citation protocols', async () => {
    mcp.callTool.mockResolvedValue(result(searchText.replace('https://jan.ai/', 'javascript:alert(1)')))
    expect(await executeWebTool('web_search', { query: 'a' })).toHaveProperty('error')
  })

  it('returns no-results messages without inventing sources or switching provider', async () => {
    mcp.callTool.mockResolvedValue(result('No results were found for your search query.'))
    expect(await executeWebTool('web_search', { query: 'a' })).toMatchObject({ content: { results: [] } })
    expect(native.webSearch).not.toHaveBeenCalled()
  })

  it.each(['Error: rate limited', 'An error occurred during search', 'unrecognized output', ''])(
    'reports plugin failures: %s', async (text) => {
      mcp.callTool.mockResolvedValue(result(text))
      expect(await executeWebTool('web_search', { query: 'a' })).toHaveProperty('error')
    }
  )

  it('propagates MCP errors', async () => {
    mcp.callTool.mockResolvedValue({ error: 'timeout', content: [] })
    expect(await executeWebTool('web_search', { query: 'a' })).toEqual({ error: 'timeout' })
  })

  it('bounds fetch output and preserves the source URL', async () => {
    mcp.callTool.mockResolvedValue(result('x'.repeat(60_000)))
    const output = await executeWebTool('web_fetch', { url: 'https://jan.ai/' })
    expect(String(output.content)).toHaveLength(40_000)
    expect(parseWebFetchOutput(output.content)).toMatchObject({ url: 'https://jan.ai/', truncated: true })
    expect(mcp.callTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'fetch_content', arguments: {
        url: 'https://jan.ai/', start_index: 0, max_length: 40_000, parse_mode: 'markdown',
      },
    }))
  })

  it('honors a smaller model context budget', async () => {
    mcp.callTool.mockResolvedValue(result('x'.repeat(10_000)))
    const output = await executeDuckDuckGoTool('web_fetch', { url: 'https://jan.ai/' }, 3600)
    expect(String(output.content).length).toBeLessThanOrEqual(3600)
    expect(parseWebFetchOutput(output.content)).toMatchObject({ url: 'https://jan.ai/', truncated: true })
    expect(mcp.callTool).toHaveBeenCalledWith(expect.objectContaining({ maxOutputChars: 3600 }))
  })

  it.skipIf(!process.env.JAN_DUCKDUCKGO_FIXTURE)('parses real MCP search and fetch responses', async () => {
    const { readFileSync } = await import('node:fs')
    const fixture = JSON.parse(readFileSync(process.env.JAN_DUCKDUCKGO_FIXTURE!, 'utf8'))
    mcp.callTool.mockResolvedValueOnce(fixture.search).mockResolvedValueOnce(fixture.fetch)
    const search = await executeWebTool('web_search', { query: 'Jan AI documentation local models', count: 3 })
    const citations = parseCitationsFromToolOutput(search.content)
    expect(citations?.kind).toBe('web')
    expect(citations?.citations).toHaveLength(3)
    const fetch = await executeWebTool('web_fetch', { url: 'https://example.com' })
    expect(parseWebFetchOutput(fetch.content)).toMatchObject({
      url: 'https://example.com', content: expect.stringContaining('documentation examples'),
    })
  })

  it.each([{}, { query: '' }, { query: 123 }])('rejects missing queries before startup: %j', async (input) => {
    expect(await executeWebTool('web_search', input)).toHaveProperty('error')
    expect(mcp.getConnectedServers).not.toHaveBeenCalled()
  })

  it.each(['file:///secret', 'javascript:alert(1)', ''])('rejects invalid fetch URLs: %s', async (url) => {
    expect(await executeWebTool('web_fetch', { url })).toHaveProperty('error')
    expect(mcp.getConnectedServers).not.toHaveBeenCalled()
  })

  it.each([[100, 20], [-1, 1], [NaN, 5], [2.7, 2]])('bounds result count %s to %s', async (count, expected) => {
    await executeWebTool('web_search', { query: 'a', count })
    expect(mcp.callTool).toHaveBeenCalledWith(expect.objectContaining({
      arguments: { query: 'a', max_results: expected },
    }))
  })

  it('does not contact any provider when disabled', async () => {
    useWebSearchConfig.setState({ webSearchEnabled: false })
    expect(await executeWebTool('web_search', { query: 'a' })).toHaveProperty('error')
    expect(mcp.getConnectedServers).not.toHaveBeenCalled()
    expect(native.webSearch).not.toHaveBeenCalled()
  })

  it('keeps the other providers and their settings working', async () => {
    useWebSearchConfig.setState({ searchProvider: 'exa', apiKeys: { exa: 'test-key' } })
    native.webSearch.mockResolvedValue([{ title: 'Jan', url: 'https://jan.ai', snippet: 'AI' }])
    expect(await executeWebTool('web_search', { query: 'Jan', count: 3 })).toHaveProperty('content')
    expect(native.webSearch).toHaveBeenCalledWith('Jan', 3, 'test-key', 'exa', undefined)
    expect(mcp.getConnectedServers).not.toHaveBeenCalled()
  })
})
