import {
  isNativeWebTool,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
} from './webToolRouting'

/**
 * Where a tool call came from. Jan runs three families of tools -- the native
 * web tools, the built-in RAG tools, and MCP server tools -- and a collapsed
 * card is ambiguous without saying which.
 */
export type ToolOrigin =
  | { kind: 'web-search'; detail: string }
  | { kind: 'web-fetch' }
  | { kind: 'rag' }
  | { kind: 'mcp'; detail: string }

export type ToolOriginContext = {
  /** MCP server owning this tool, when it is an MCP tool. */
  mcpServer?: string
  isRagTool: boolean
  /** Whether Jan's native web-search tools are currently advertised. */
  nativeWebSearchEnabled: boolean
  /** Display name of the configured web search provider, e.g. "Exa". */
  webSearchProviderLabel: string
}

/**
 * Resolution order mirrors the execution order in the thread route: native web
 * tools win, then RAG, then MCP. RAG names shadowed by an MCP server are
 * already dropped from the RAG set upstream, so the two cannot both match.
 */
export function resolveToolOrigin(
  toolName: string,
  {
    mcpServer,
    isRagTool,
    nativeWebSearchEnabled,
    webSearchProviderLabel,
  }: ToolOriginContext
): ToolOrigin | undefined {
  const isNativeWeb = isNativeWebTool(toolName, nativeWebSearchEnabled)
  if (isNativeWeb && toolName === WEB_SEARCH_TOOL) {
    return { kind: 'web-search', detail: webSearchProviderLabel }
  }
  if (isNativeWeb && toolName === WEB_FETCH_TOOL) {
    return { kind: 'web-fetch' }
  }
  if (isRagTool) return { kind: 'rag' }
  if (mcpServer) return { kind: 'mcp', detail: mcpServer }
  return undefined
}
