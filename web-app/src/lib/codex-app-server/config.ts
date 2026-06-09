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
  env: Record<string, string | undefined>
}

export type CodexConfigTomlOptions = {
  model?: string
  modelProvider?: string
  providers?: CodexProviderConfig[]
}

export const buildCodexSpawnCommand = (options: CodexSessionOptions): CodexSpawnCommand => {
  const cwd = options.cwd ?? DEFAULT_WORKSPACE_DIR
  const codexHome = options.codexHome ?? DEFAULT_CODEX_HOME
  return {
    command: options.codexBinaryPath ?? DEFAULT_CODEX_BINARY,
    args: ['app-server', '--stdio'],
    cwd,
    codexHome,
    configToml: options.configToml,
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
    if (provider.baseUrl) lines.push(`base_url = ${tomlString(provider.baseUrl)}`)
    if (provider.apiKeyEnvVar) lines.push(`env_key = ${tomlString(provider.apiKeyEnvVar)}`)
    if (provider.wireApi) lines.push(`wire_api = ${tomlString(provider.wireApi)}`)
    lines.push('')
  })

  return lines.join('\n').trim()
}

const tomlKey = (value: string) => {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) return value
  return tomlString(value)
}

const tomlString = (value: string) => JSON.stringify(value)
