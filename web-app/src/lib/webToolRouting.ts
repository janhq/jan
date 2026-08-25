export const WEB_SEARCH_TOOL = 'web_search'
export const WEB_FETCH_TOOL = 'web_fetch'

export const WEB_TOOL_NAMES = new Set([WEB_SEARCH_TOOL, WEB_FETCH_TOOL])

/**
 * A same-named MCP tool is still an MCP tool when Jan's native web search is
 * disabled. Keep dispatch in sync with refreshTools(), which only advertises
 * the native tools while this setting is enabled.
 */
export function isNativeWebTool(
  toolName: string,
  webSearchEnabled: boolean
): boolean {
  return webSearchEnabled && WEB_TOOL_NAMES.has(toolName)
}
