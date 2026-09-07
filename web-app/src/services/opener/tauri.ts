/**
 * Tauri Opener Service - Desktop implementation
 */

import {
  openPath as osOpenPath,
  revealItemInDir as osRevealItemInDir,
} from '@tauri-apps/plugin-opener'
import { DefaultOpenerService } from './default'

export class TauriOpenerService extends DefaultOpenerService {
  /**
   * Delegated to the plugin, which uses the native call per OS
   * (SHOpenFolderAndSelectItems on Windows, the FileManager1 D-Bus interface on
   * Linux, AppKit on macOS) — spawning `explorer /select,<path>` ourselves
   * breaks on paths containing spaces, and `xdg-open` cannot select at all.
   */
  async revealItemInDir(path: string): Promise<void> {
    try {
      await osRevealItemInDir(path)
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
