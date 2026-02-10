import { isPlatformTauri } from '@/lib/platform/utils'
import { invoke } from '@tauri-apps/api/core'
import { useCallback } from 'react'

/**
 * Hook for detecting system directories for the agent working directory feature.
 *
 * Provides functions to retrieve:
 * - Jan's application data directory (where models, extensions are stored)
 * - The current working directory of the running process
 */
export function useAgentWorkingDirectory() {
  /**
   * Get Jan's application data directory.
   * Returns null on web (not applicable).
   */
  const getDataDirectory = useCallback(async (): Promise<string | null> => {
    if (!isPlatformTauri()) return null
    try {
      return await invoke<string>('get_app_data_dir')
    } catch (e) {
      console.error('[useAgentWorkingDirectory] Failed to get app data dir:', e)
      return null
    }
  }, [])

  /**
   * Get the current working directory.
   * Returns null on web (not applicable).
   */
  const getCurrentDirectory = useCallback(async (): Promise<string | null> => {
    if (!isPlatformTauri()) return null
    try {
      return await invoke<string>('get_current_dir')
    } catch (e) {
      console.error('[useAgentWorkingDirectory] Failed to get current dir:', e)
      return null
    }
  }, [])

  return { getDataDirectory, getCurrentDirectory }
}