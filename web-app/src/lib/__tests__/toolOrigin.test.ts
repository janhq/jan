import { describe, expect, it } from 'vitest'
import { resolveToolOrigin } from '../toolOrigin'

const context = {
  isRagTool: false,
  isAgentTool: false,
  webSearchProviderLabel: 'Exa',
  webSearchEnabled: true,
}

describe('resolveToolOrigin', () => {
  it('attributes web_search to the configured provider', () => {
    expect(resolveToolOrigin('web_search', context)).toEqual({
      kind: 'web-search',
      detail: 'Exa',
    })
  })

  it('tracks a provider change', () => {
    expect(
      resolveToolOrigin('web_search', {
        ...context,
        webSearchProviderLabel: 'Tavily',
      })
    ).toEqual({ kind: 'web-search', detail: 'Tavily' })
  })

  it('recognises web_fetch', () => {
    expect(resolveToolOrigin('web_fetch', context)).toEqual({
      kind: 'web-fetch',
    })
  })

  it('recognises a RAG tool', () => {
    expect(
      resolveToolOrigin('search_documents', { ...context, isRagTool: true })
    ).toEqual({ kind: 'rag' })
  })

  it('names the MCP server for a server tool', () => {
    expect(
      resolveToolOrigin('read_file', { ...context, mcpServer: 'filesystem' })
    ).toEqual({ kind: 'mcp', detail: 'filesystem' })
  })

  // Mirrors the thread route: while web search is on the native tool is what
  // was offered and what runs, even when an MCP server has the same name.
  it('prefers the native web tool over a same-named MCP tool while web search is on', () => {
    expect(
      resolveToolOrigin('web_search', { ...context, mcpServer: 'someserver' })
    ).toEqual({ kind: 'web-search', detail: 'Exa' })
  })

  // With it off the MCP server's tool is the one that ran (#9458); labelling
  // it as the built-in provider would credit a search Exa never saw.
  it.each(['web_search', 'web_fetch'])(
    'credits a same-named MCP %s to its server while web search is off',
    (name) => {
      expect(
        resolveToolOrigin(name, {
          ...context,
          webSearchEnabled: false,
          mcpServer: 'parallel',
        })
      ).toEqual({ kind: 'mcp', detail: 'parallel' })
    }
  )

  it('keeps the built-in label for a recorded web call no server provides', () => {
    expect(
      resolveToolOrigin('web_search', { ...context, webSearchEnabled: false })
    ).toEqual({ kind: 'web-search', detail: 'Exa' })
  })

  it('prefers RAG over MCP when both somehow match', () => {
    expect(
      resolveToolOrigin('search_documents', {
        ...context,
        isRagTool: true,
        mcpServer: 'someserver',
      })
    ).toEqual({ kind: 'rag' })
  })

  it('recognises a built-in agent tool', () => {
    expect(
      resolveToolOrigin('memory', { ...context, isAgentTool: true })
    ).toEqual({ kind: 'agent' })
  })

  // Mirrors the thread route, where agent tools are dispatched before MCP, so a
  // filesystem server exposing `read` does not claim the built-in one's card.
  it('prefers the built-in agent tool over a same-named MCP tool', () => {
    expect(
      resolveToolOrigin('read', {
        ...context,
        isAgentTool: true,
        mcpServer: 'filesystem',
      })
    ).toEqual({ kind: 'agent' })
  })

  it('is undefined for an unknown tool', () => {
    expect(resolveToolOrigin('mystery', context)).toBeUndefined()
  })
})
