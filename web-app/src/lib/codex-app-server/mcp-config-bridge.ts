import type { MCPServerConfig, MCPServers } from '@/hooks/useMCPServers'

/**
 * MCP Config Bridge — the primary connection from Jan's MCP system into the Codex engine.
 *
 * When using the 'codex' provider (Codex app-server as the agent engine):
 * - Jan's useMCPServers store + UI remains the source of truth for available tools/servers.
 * - This module projects active servers into the [mcp_servers.*] section of the Codex config.toml
 *   written for each session (see config.ts + chat-backend.ts buildCodexSessionOptions).
 * - Codex (the plugged-in engine) is then responsible for spawning the MCP server processes
 *   (stdio or http) and performing all tool calling, selection, parallel use, etc.
 * - Jan no longer proxies 'item/tool/call' execution for Codex (see chat-backend.ts disconnect).
 *   Approvals (including mcp elicitation) and the config itself are still mediated by Jan.
 *
 * This keeps Jan as the desktop host (MCP curation, approvals UI, workspace management,
 * provider profiles for local models, event rendering) while Codex is the engine.
 */

export type CodexMcpServerTomlEntry = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  http_headers?: Record<string, string>
  enabled?: boolean
  startup_timeout_sec?: number
  tool_timeout_sec?: number
  // Advanced Codex MCP
  enabled_tools?: string[]
  disabled_tools?: string[]
  default_tools_approval_mode?: string
  required?: boolean
  cwd?: string
  env_vars?: unknown
}

export type JanMcpToCodexOptions = {
  toolTimeoutSeconds?: number
}

export function getActiveJanMcpServers(
  servers: MCPServers
): Array<[string, MCPServerConfig]> {
  return Object.entries(servers)
    .filter(([, config]) => config.active !== false)
    .sort(([left], [right]) => left.localeCompare(right))
}

export function janMcpServerToCodexEntry(
  config: MCPServerConfig,
  options: JanMcpToCodexOptions = {}
): CodexMcpServerTomlEntry | null {
  const transport = config.type ?? 'stdio'

  if (transport === 'http' || transport === 'sse') {
    const url = config.url?.trim()
    if (!url) return null

    const entry: CodexMcpServerTomlEntry = { url }
    const headers = compactStringRecord(config.headers)
    if (headers) entry.http_headers = headers
    if (options.toolTimeoutSeconds) {
      entry.tool_timeout_sec = options.toolTimeoutSeconds
    }
    return entry
  }

  const command = config.command?.trim()
  if (!command) return null

  const entry: CodexMcpServerTomlEntry = { command }
  const args = config.args?.filter(
    (arg) => typeof arg === 'string' && arg.length > 0
  )
  if (args && args.length > 0) entry.args = args

  const env = compactStringRecord(config.env)
  if (env) entry.env = env

  if (typeof config.timeout === 'number' && config.timeout > 0) {
    entry.tool_timeout_sec = config.timeout
  } else if (options.toolTimeoutSeconds) {
    entry.tool_timeout_sec = options.toolTimeoutSeconds
  }

  // Codex advanced
  if (config.enabledTools && config.enabledTools.length > 0)
    entry.enabled_tools = config.enabledTools
  if (config.disabledTools && config.disabledTools.length > 0)
    entry.disabled_tools = config.disabledTools
  if (config.defaultToolsApprovalMode)
    entry.default_tools_approval_mode = config.defaultToolsApprovalMode
  if (config.required) entry.required = true
  if (config.cwd) entry.cwd = config.cwd
  if (config.envVars) entry.env_vars = config.envVars

  return entry
}

export function buildCodexMcpServersToml(
  servers: MCPServers,
  options: JanMcpToCodexOptions = {}
): string {
  const lines: string[] = []

  for (const [name, config] of getActiveJanMcpServers(servers)) {
    const entry = janMcpServerToCodexEntry(config, options)
    if (!entry) continue

    lines.push(`[mcp_servers.${tomlTableKey(name)}]`)
    lines.push(...renderCodexMcpServerEntry(entry))
    lines.push('')
  }

  return lines.join('\n').trim()
}

export function buildCodexMcpServersConfig(
  servers: MCPServers,
  options: JanMcpToCodexOptions = {}
): Record<string, CodexMcpServerTomlEntry> {
  const config: Record<string, CodexMcpServerTomlEntry> = {}

  for (const [name, server] of getActiveJanMcpServers(servers)) {
    const entry = janMcpServerToCodexEntry(server, options)
    if (!entry) continue
    config[name] = entry
  }

  return config
}

function renderCodexMcpServerEntry(entry: CodexMcpServerTomlEntry): string[] {
  const lines: string[] = []

  if (entry.command) lines.push(`command = ${tomlString(entry.command)}`)
  if (entry.args) lines.push(`args = ${tomlArray(entry.args)}`)
  if (entry.env) lines.push(`env = ${tomlInlineTable(entry.env)}`)
  if (entry.url) lines.push(`url = ${tomlString(entry.url)}`)
  if (entry.http_headers) {
    lines.push(`http_headers = ${tomlInlineTable(entry.http_headers)}`)
  }
  if (entry.enabled === false) lines.push('enabled = false')
  if (entry.startup_timeout_sec) {
    lines.push(`startup_timeout_sec = ${entry.startup_timeout_sec}`)
  }
  if (entry.tool_timeout_sec) {
    lines.push(`tool_timeout_sec = ${entry.tool_timeout_sec}`)
  }
  if (entry.enabled_tools)
    lines.push(`enabled_tools = ${tomlArray(entry.enabled_tools)}`)
  if (entry.disabled_tools)
    lines.push(`disabled_tools = ${tomlArray(entry.disabled_tools)}`)
  if (entry.default_tools_approval_mode)
    lines.push(
      `default_tools_approval_mode = ${tomlString(entry.default_tools_approval_mode)}`
    )
  if (entry.required) lines.push('required = true')
  if (entry.cwd) lines.push(`cwd = ${tomlString(entry.cwd)}`)
  if (entry.env_vars)
    lines.push(`env_vars = ${tomlInlineTableOrArray(entry.env_vars)}`)

  return lines
}

const tomlInlineTableOrArray = (value: unknown) => {
  if (Array.isArray(value)) return tomlArray(value as string[])
  if (value && typeof value === 'object')
    return tomlInlineTable(value as Record<string, string>)
  return tomlString(String(value))
}

const tomlTableKey = (value: string) => {
  const trimmed = value.trim()
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) return trimmed
  return tomlString(trimmed)
}

const tomlString = (value: string) => JSON.stringify(value)

const tomlArray = (values: string[]) =>
  `[${values.map((value) => tomlString(value)).join(', ')}]`

const tomlInlineTable = (values: Record<string, string>) => {
  const entries = Object.entries(values).map(
    ([key, value]) => `${tomlTableKey(key)} = ${tomlString(value)}`
  )
  return `{ ${entries.join(', ')} }`
}

function compactStringRecord(
  values: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!values) return undefined
  const compact = Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => typeof value === 'string' && value.length > 0
    )
  )
  return Object.keys(compact).length > 0 ? compact : undefined
}
