import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { logError } from './logger'

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args)
  } catch (e) {
    logError(`invoke('${cmd}') failed: ${e}`, {
      command: cmd,
      args,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    })
    throw e
  }
}
