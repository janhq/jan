/**
 * Tauri Opener Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
// Aliased: the method below is also `openPath`, and an unaliased import
// would shadow confusingly at the call site.
import { openPath as osOpenPath } from '@tauri-apps/plugin-opener'
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

  async openPath(path: string): Promise<void> {
    try {
      await osOpenPath(path)
    } catch (error) {
      console.error('Error opening path in Tauri:', error)
      throw error
    }
  }
}
