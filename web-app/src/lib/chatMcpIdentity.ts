import type { MCPTool } from '@/types/completion'

/** Keep wire names compatible; collisions are withheld, never renamed or picked. */
export function uniqueMcpTools(tools: MCPTool[]): MCPTool[] {
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  return tools.filter((tool) => Boolean(tool.server?.trim()) && counts.get(tool.name) === 1)
}

/** Check the bound pair, not another server with the same tool name. */
export async function assertMcpIdentityAvailable(
  toolName: string,
  serverName: string | undefined,
  getTools: () => Promise<MCPTool[]>,
  isDisabled: (server: string, tool: string) => boolean
): Promise<void> {
  if (!serverName || isDisabled(serverName, toolName)) {
    throw new Error(`MCP tool '${toolName}' is unavailable or disabled`)
  }
  const tools = await getTools()
  if (!uniqueMcpTools(tools).some((tool) => tool.name === toolName && tool.server === serverName) ||
      isDisabled(serverName, toolName)) {
    throw new Error(`MCP identity for '${toolName}' is stale, ambiguous or unavailable`)
  }
}
