import { isPlatformTauri } from '@/lib/platform'
import type { CoworkEnvironment } from '@/lib/coworkPrompt'

/**
 * Facts about the machine the agent is running on, for the system prompt's
 * `# Environment` block. The OS/app half never changes for a process, so it is
 * gathered once; the date is stamped fresh on every call because a session can
 * outlive midnight.
 */
let staticEnv: Omit<CoworkEnvironment, 'date'> | null = null

async function gatherStatic(): Promise<Omit<CoworkEnvironment, 'date'>> {
  let os: string | null = null
  let arch: string | null = null
  let appVersion: string | null = null
  if (isPlatformTauri()) {
    try {
      const osApi = await import('@tauri-apps/plugin-os')
      os = osApi.platform()
      arch = osApi.arch()
      const { getVersion } = await import('@tauri-apps/api/app')
      appVersion = await getVersion()
    } catch {
      // Web build or a missing plugin: the block simply omits these lines.
    }
  }
  return {
    os,
    arch,
    appVersion,
    locale: typeof navigator !== 'undefined' ? navigator.language : null,
  }
}

export async function getCoworkEnvironment(): Promise<CoworkEnvironment> {
  if (!staticEnv) staticEnv = await gatherStatic()
  return { ...staticEnv, date: new Date().toDateString() }
}
