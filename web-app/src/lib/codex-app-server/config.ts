import type { MCPServers } from '@/hooks/useMCPServers'
import { buildCodexMcpServersToml } from './mcp-config-bridge'
import type { CodexProviderConfig, CodexSessionOptions } from './types'

const DEFAULT_CODEX_BINARY = 'codex'
const DEFAULT_CODEX_HOME = './.jan/codex-home'
const DEFAULT_WORKSPACE_DIR = './'

export type CodexSpawnCommand = {
  command: string
  args: string[]
  cwd: string
  codexHome: string
  configToml?: string
  agentsMd?: string
  env: Record<string, string | undefined>
}

export type CodexConfigTomlOptions = {
  model?: string
  modelProvider?: string
  providers?: CodexProviderConfig[]
  mcpServers?: MCPServers
  mcpToolTimeoutSeconds?: number
  // Codex engine features projected to toml
  agents?: { max_threads?: number; max_depth?: number }
  defaultPermissions?: string
  /** Raw advanced snippet (hooks/rules/skills/plugins/...) appended verbatim so Codex loads it for the session. */
  advancedConfigSnippet?: string
}

export const buildCodexSpawnCommand = (
  options: CodexSessionOptions
): CodexSpawnCommand => {
  const cwd = options.cwd ?? DEFAULT_WORKSPACE_DIR
  const codexHome = options.codexHome ?? DEFAULT_CODEX_HOME
  const args =
    options.transport === 'proto' ? ['proto'] : ['app-server', '--stdio']
  return {
    command: options.codexBinaryPath ?? DEFAULT_CODEX_BINARY,
    args,
    cwd,
    codexHome,
    configToml: options.configToml,
    agentsMd: options.agentsMd,
    env: {
      ...options.env,
      CODEX_HOME: codexHome,
      LOG_FORMAT: options.env?.LOG_FORMAT ?? 'json',
    },
  }
}

export const buildThreadStartParams = (options: CodexSessionOptions) => ({
  model: options.model ?? null,
  modelProvider: options.modelProvider ?? null,
  cwd: options.cwd ?? DEFAULT_WORKSPACE_DIR,
  approvalPolicy: options.approvalPolicy ?? 'on-request',
  sandbox: options.sandbox ?? 'workspace-write',
  serviceName: options.serviceName ?? 'Jan',
  // Extra grant roots for Codex (maps to --add-dir behavior / extra workspace roots)
  ...(options.addDirs && options.addDirs.length > 0
    ? { extraDirectories: options.addDirs }
    : {}),
})

export const buildCodexConfigToml = (
  input: CodexProviderConfig[] | CodexConfigTomlOptions = []
) => {
  const providers = Array.isArray(input) ? input : (input.providers ?? [])
  const lines: string[] = []

  if (!Array.isArray(input)) {
    if (input.model) lines.push(`model = ${tomlString(input.model)}`)
    if (input.modelProvider) {
      lines.push(`model_provider = ${tomlString(input.modelProvider)}`)
    }
    if (lines.length > 0 && providers.length > 0) lines.push('')
  }

  providers.forEach((provider) => {
    lines.push(`[model_providers.${tomlKey(provider.id)}]`)
    lines.push(`name = ${tomlString(provider.name ?? provider.id)}`)
    if (provider.baseUrl)
      lines.push(`base_url = ${tomlString(provider.baseUrl)}`)
    if (provider.apiKeyEnvVar)
      lines.push(`env_key = ${tomlString(provider.apiKeyEnvVar)}`)
    if (provider.wireApi)
      lines.push(`wire_api = ${tomlString(provider.wireApi)}`)
    lines.push('')
  })

  if (!Array.isArray(input) && input.mcpServers) {
    const mcpToml = buildCodexMcpServersToml(input.mcpServers, {
      toolTimeoutSeconds: input.mcpToolTimeoutSeconds,
    })
    if (mcpToml) {
      if (lines.length > 0) lines.push('')
      lines.push(mcpToml)
    }
  }

  // Agents / subagents for Codex engine
  if (
    !Array.isArray(input) &&
    (input.agents?.max_threads || input.agents?.max_depth)
  ) {
    if (lines.length > 0) lines.push('')
    lines.push('[agents]')
    if (input.agents.max_threads)
      lines.push(`max_threads = ${input.agents.max_threads}`)
    if (input.agents.max_depth)
      lines.push(`max_depth = ${input.agents.max_depth}`)
  }

  // Permission profiles (new style; user should also provide [permissions.xxx] via full config or external if needed)
  if (!Array.isArray(input) && input.defaultPermissions) {
    if (lines.length > 0 && !lines[lines.length - 1].startsWith('['))
      lines.push('')
    lines.push(`default_permissions = ${tomlString(input.defaultPermissions)}`)
  }

  // Advanced snippet for hooks, rules, skills, plugins, and other Codex config sections.
  // First-class in Studio profiles + auto-written to the session's CODEX_HOME/config.toml .
  if (!Array.isArray(input) && input.advancedConfigSnippet) {
    const snippet = input.advancedConfigSnippet.trim()
    if (snippet) {
      if (lines.length > 0) lines.push('')
      lines.push('# --- advanced config snippet from active Codex provider profile (hooks/rules/skills/plugins/etc) ---')
      lines.push(snippet)
    }
  }

  return lines.join('\n').trim()
}

const tomlKey = (value: string) => {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) return value
  return tomlString(value)
}

const tomlString = (value: string) => JSON.stringify(value)
