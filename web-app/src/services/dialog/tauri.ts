/**
 * Tauri Dialog Service - Desktop implementation
 */

import { open, save } from '@tauri-apps/plugin-dialog'
import type { DialogOpenOptions } from './types'
import { DefaultDialogService } from './default'

export class TauriDialogService extends DefaultDialogService {
  async open(options?: DialogOpenOptions): Promise<string | string[] | null> {
    try {
      return await open(options)
    } catch (error) {
      console.error('Error opening dialog in Tauri:', error)
      return null
    }
  }

  async save(options?: DialogOpenOptions): Promise<string | null> {
    try {
      return await save(options)
    } catch (error) {
      console.error('Error opening save dialog in Tauri:', error)
      return null
    }
  }
}