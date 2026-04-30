/**
 * Tauri Dialog Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import type { DialogOpenOptions } from './types'
import { DefaultDialogService } from './default'

export class TauriDialogService extends DefaultDialogService {
  async open(options?: DialogOpenOptions): Promise<string | string[] | null> {
    try {
      return await invoke<string | string[] | null>('open_dialog', { options })
    } catch (error) {
      console.error('Error opening dialog in Tauri:', error)
      return null
    }
  }

  async save(options?: DialogOpenOptions): Promise<string | null> {
    try {
      return await invoke<string | null>('save_dialog', { options })
    } catch (error) {
      console.error('Error opening save dialog in Tauri:', error)
      return null
    }
  }
}
