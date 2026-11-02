import type { MCPTool } from '@/types/completion'

/** Keep wire names compatible; collisions are withheld, never renamed or picked. */
export function uniqueMcpTools(tools: MCPTool[]): MCPTool[] {
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  return tools.filter((tool) => Boolean(tool.server?.trim()) && counts.get(tool.name) === 1)
}

/** Diagnose advertisement omissions using names only, never schemas/config/arguments. */
export function warnWithheldMcpTools(tools: MCPTool[]): void {
  const byName = new Map<string, MCPTool[]>()
  for (const tool of tools) {
    const group = byName.get(tool.name) ?? []
    group.push(tool)
    byName.set(tool.name, group)
  }
  for (const [name, group] of byName) {
    const missing = group.some((tool) => !tool.server?.trim())
    if (group.length < 2 && !missing) continue
    const servers = group.map((tool) => tool.server?.trim() ? tool.server : '(missing server identity)')
    console.warn(
      `[tools] Withheld MCP tool ${JSON.stringify(name)}: ${group.length > 1 ? 'name collision' : 'missing server identity'}; servers: ${servers.map((server) => JSON.stringify(server)).join(', ')}`
    )
  }
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
