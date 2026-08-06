import type { HardwareData } from '@/hooks/useHardware'

/**
 * Details about the current user environment drawn from the running app.
 * Everything here is safe to expose to the model - it describes the machine
 * the assistant is running on, not private conversation data.
 */
export interface SystemEnvInfo {
  /** Human-readable OS name and version, e.g. "macOS 14.5" - mutually
   *  exclusive with `platform`. */
  osName?: string
  /** Generic platform label: "Windows", "macOS", or "Linux". */
  platform?: string
  /** CPU architecture, e.g. "arm64" or "x86_64". */
  arch?: string
  /** Human-readable CPU model name, when detected. */
  cpuName?: string
  /** Total system memory in bytes, when detected. */
  totalMemory?: number
  /** The Jan app version currently running. */
  janVersion?: string
}

/**
 * Build the full system prompt for a chat by combining the user-configured
 * assistant instructions with a block describing the current environment
 * (OS, CPU, memory, app version).
 *
 * The instructions are placed first so the user's configuration takes
 * priority; the environment block is appended as supporting context the model
 * can use to tailor its answers. Whitespace-only instructions are dropped so
 * we never emit an empty system turn.
 *
 * Returns `undefined` when there is nothing to send (no instructions and no
 * usable environment info), so callers can skip the system message entirely.
 */
export function buildSystemPrompt(
  instructions: string | undefined,
  env: SystemEnvInfo = {}
): string | undefined {
  const parts: string[] = []

  if (instructions && instructions.trim().length > 0) {
    parts.push(instructions.trim())
  }

  const envBlock = buildEnvironmentBlock(env)
  if (envBlock) parts.push(envBlock)

  if (parts.length === 0) return undefined
  return parts.join('\n\n')
}

/**
 * Render the environment context block from a given set of environment
 * details. Returns an empty string when nothing usable is provided so the
 * caller can decide whether to include it.
 */
export function buildEnvironmentBlock(env: SystemEnvInfo): string {
  const lines: string[] = []

  const os = env.osName || env.platform
  if (os) lines.push(`OS: ${os}`)
  if (env.arch) lines.push(`Architecture: ${env.arch}`)
  if (env.cpuName) lines.push(`CPU: ${env.cpuName}`)
  if (env.totalMemory) lines.push(`Memory: ${formatMemory(env.totalMemory)}`)
  if (env.janVersion) lines.push(`Jan version: ${env.janVersion}`)

  if (lines.length === 0) return ''

  return ['# Current environment', ...lines.map((l) => `- ${l}`)].join('\n')
}

/**
 * Derive the environment info for the currently running desktop session from
 * the hardware store and build-time platform/version constants.
 */
export function getSystemEnv(hardware: HardwareData): SystemEnvInfo {
  const osName = hardware.os_name?.trim() || undefined
  const osType = hardware.os_type?.trim().toLowerCase()
  const platform = osType ? platformLabel(osType) : platformLabel(PLATFORM)

  return {
    osName,
    platform: osName ? undefined : platform,
    arch: hardware.cpu?.arch || undefined,
    cpuName: hardware.cpu?.name || undefined,
    totalMemory: hardware.total_memory || undefined,
    janVersion: VERSION || undefined,
  }
}

/** Map an internal os type / platform token to a display label. */
function platformLabel(value?: string): string | undefined {
  switch (value) {
    case 'win32':
    case 'windows':
      return 'Windows'
    case 'darwin':
    case 'macos':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return undefined
  }
}

function formatMemory(bytes: number): string {
  const gb = bytes / 1024 ** 3
  const rounded = gb >= 100 ? Math.round(gb) : Math.round(gb * 10) / 10
  return `${rounded} GB`
}
