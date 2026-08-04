import { describe, expect, it } from 'vitest'
import { resolveToolOrigin } from '../toolOrigin'

const context = {
  isRagTool: false,
  webSearchProviderLabel: 'Exa',
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

  // Mirrors the thread route's execution order, where native web tools are
  // dispatched before any MCP tool of the same name.
  it('prefers the native web tool over a same-named MCP tool', () => {
    expect(
      resolveToolOrigin('web_search', { ...context, mcpServer: 'someserver' })
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

  it('is undefined for an unknown tool', () => {
    expect(resolveToolOrigin('mystery', context)).toBeUndefined()
  })
})
