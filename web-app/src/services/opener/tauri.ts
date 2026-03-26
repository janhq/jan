/**
 * Tauri Opener Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { DefaultOpenerService } from './default'

export class TauriOpenerService extends DefaultOpenerService {
  async revealItemInDir(path: string): Promise<void> {
    try {
      if (IS_LINUX) {
        await invoke('open_file_explorer', { path })
        return
      }
      await revealItemInDir(path)
    } catch (error) {
      console.error('Error revealing item in directory in Tauri:', error)
      throw error
    }
  }
}
