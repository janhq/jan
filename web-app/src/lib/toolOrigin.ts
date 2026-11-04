/**
 * Where a tool call came from. Jan runs five families of tools -- the native
 * web tools, the built-in RAG tools, the built-in agent tools, subagent
 * dispatch, and MCP server tools -- and a collapsed card is ambiguous without
 * saying which.
 */
export type ToolOrigin =
  | { kind: 'web-search'; detail: string }
  | { kind: 'web-fetch' }
  | { kind: 'rag' }
  | { kind: 'agent' }
  /** `task`: not a tool the workspace runs, but a whole nested agent. */
  | { kind: 'subagent' }
  | { kind: 'mcp'; detail: string }

export type ToolOriginContext = {
  /** MCP server owning this tool, when it is an MCP tool. */
  mcpServer?: string
  /** Request snapshot: string = MCP, null = internal, undefined = legacy/unknown. */
  boundMcpServer?: string | null
  isRagTool: boolean
  isAgentTool: boolean
  /** Display name of the configured web search provider, e.g. "Exa". */
  webSearchProviderLabel: string
  /** Whether built-in web search is on: it only owns a web tool name then. */
  webSearchEnabled: boolean
}

export const WEB_SEARCH_TOOL = 'web_search'
export const WEB_FETCH_TOOL = 'web_fetch'
export const TASK_TOOL = 'task'

/** Request-bound identity wins; legacy cards retain name-based inference. */
export function resolveToolOrigin(
  toolName: string,
  {
    mcpServer,
    boundMcpServer,
    isRagTool,
    isAgentTool,
    webSearchProviderLabel,
    webSearchEnabled,
  }: ToolOriginContext
): ToolOrigin | undefined {
  if (boundMcpServer) return { kind: 'mcp', detail: boundMcpServer }
  // An actually advertised internal schema must not inherit a live MCP menu
  // entry after routing/refresh. Null deliberately differs from unknown history.
  if (boundMcpServer === null) mcpServer = undefined
  // With web search off nothing built-in was offered, so an MCP server's tool
  // of the same name is the one that ran (`webToolRoute`). A recorded call with
  // no such server keeps its built-in label: it is history, not a live route.
  const builtinWins = webSearchEnabled || !mcpServer
  if (toolName === WEB_SEARCH_TOOL && builtinWins) {
    return { kind: 'web-search', detail: webSearchProviderLabel }
  }
  if (toolName === WEB_FETCH_TOOL && builtinWins) return { kind: 'web-fetch' }
  // Dispatched by the surface rather than the plugin, so it is not in the agent
  // tool set and would otherwise fall through to the unlabelled generic card.
  if (toolName === TASK_TOOL) return { kind: 'subagent' }
  if (isAgentTool) return { kind: 'agent' }
  // Without recorded request identity an overlapping historical card cannot
  // safely credit either the internal retriever or today's external server.
  if (isRagTool && mcpServer) return undefined
  if (isRagTool) return { kind: 'rag' }
  if (mcpServer) return { kind: 'mcp', detail: mcpServer }
  return undefined
}
