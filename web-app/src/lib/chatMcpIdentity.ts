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
  isDisabled: (server: string, tool: string) => boolean,
  signal?: AbortSignal,
  timeoutSeconds = 30
): Promise<void> {
  if (!serverName || isDisabled(serverName, toolName)) {
    throw new Error(`MCP tool '${toolName}' is unavailable or disabled`)
  }
  // Bound fresh discovery; Stop cancels this wait even if an IPC inventory
  // request cannot itself be interrupted. Late results cannot grant trust.
  let cleanup = () => {}
  const tools = await new Promise<MCPTool[]>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal?.aborted) { abort(); return }
    const timer = setTimeout(() => reject(new Error('MCP identity validation timed out; retry')), Math.max(1, Number.isFinite(timeoutSeconds) ? timeoutSeconds : 30) * 1000)
    signal?.addEventListener('abort', abort, { once: true })
    cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    Promise.resolve().then(() => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return getTools()
    }).then(resolve, reject)
  }).finally(() => cleanup())
  if (!tools.some((tool) => tool.name === toolName && tool.server === serverName) ||
      isDisabled(serverName, toolName)) {
    throw new Error(`MCP identity for '${toolName}' is stale or unavailable`)
  }
}

/** One fresh pre-prompt snapshot per call; local policy/inventory changes refuse
 * reuse rather than silently approving a stale snapshot. Rust rechecks live at dispatch. */
export function memoizeMcpValidation(
  validate: (signal?: AbortSignal) => Promise<void>,
  snapshot: () => readonly unknown[]
): (signal?: AbortSignal) => Promise<void> {
  let pending: Promise<void> | undefined
  let version: readonly unknown[] | undefined
  return async (signal) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const current = snapshot()
    if (version && version.some((value, i) => value !== current[i])) {
      throw new Error('MCP identity or approval settings changed; retry the call')
    }
    version ??= current
    pending ??= validate(signal)
    await pending
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (version.some((value, i) => value !== snapshot()[i])) {
      throw new Error('MCP identity or approval settings changed; retry the call')
    }
  }
}

// Invalidated synchronously when the existing MCP_UPDATE refresh begins, before
// potentially slow advertisement discovery returns.
let inventoryRevision = 0
export const mcpValidationRevision = () => inventoryRevision
export const invalidateMcpValidation = () => { inventoryRevision += 1 }
