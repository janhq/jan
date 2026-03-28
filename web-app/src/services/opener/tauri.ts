/**
 * Tauri Opener Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { DefaultOpenerService } from './default'

export class TauriOpenerService extends DefaultOpenerService {
  async revealItemInDir(path: string): Promise<void> {
    try {
      await invoke('open_file_explorer', { path })
    } catch (error) {
      console.error('Error revealing item in directory in Tauri:', error)
      throw error
    }
  }
}
