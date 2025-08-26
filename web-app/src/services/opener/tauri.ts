/**
 * Tauri Opener Service - Desktop implementation
 * 
 * MOVED FROM: routes/settings/general.tsx (revealItemInDir calls)
 * NO IMPLEMENTATION CHANGES - EXACT SAME LOGIC MOVED HERE
 */

import { revealItemInDir } from '@tauri-apps/plugin-opener'
// import type { OpenerService } from './types'
import { DefaultOpenerService } from './default'

export class TauriOpenerService extends DefaultOpenerService {
  async revealItemInDir(path: string): Promise<void> {
    try {
      // MOVED FROM route files - exact same implementation
      await revealItemInDir(path)
    } catch (error) {
      console.error('Error revealing item in directory in Tauri, falling back to default:', error)
      return super.revealItemInDir(path)
    }
  }

  async openPath(path: string): Promise<void> {
    try {
      // Note: @tauri-apps/plugin-opener doesn't have an open function
      // We'll use the default implementation for now
      return super.openPath(path)
    } catch (error) {
      console.error('Error opening path in Tauri, falling back to default:', error)
      return super.openPath(path)
    }
  }
}