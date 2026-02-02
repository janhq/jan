/**
 * Tauri Dialog Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { DialogOpenOptions } from './types'
import { DefaultDialogService } from './default'

export class TauriDialogService extends DefaultDialogService {
  async open(options?: DialogOpenOptions): Promise<string | string[] | null> {
    try {
      console.log('TauriDialogService: Opening dialog with options:', options)
      if (options?.filters) {
        console.log('TauriDialogService: File filters:', options.filters)
        options.filters.forEach((filter, index) => {
          console.log(
            `TauriDialogService: Filter ${index} - Name: "${filter.name}", Extensions:`,
            filter.extensions
          )
        })
      }
      const result = await open({
        ...options,
      })
      console.log('TauriDialogService: Dialog result:', result)
      return result
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
