/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Web Dialog Service - Web implementation
 * Provides web-specific implementations for dialog operations
 */

import type { DialogService, DialogOpenOptions } from './types'

export class WebDialogService implements DialogService {
  async open(options?: DialogOpenOptions): Promise<string | string[] | null> {
    // Web fallback - create hidden input element
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = options?.multiple ?? false
      
      if (options?.directory) {
        input.webkitdirectory = true
      }

      if (options?.filters) {
        console.log('WebDialogService: Processing file filters:', options.filters)
        const extensions = options.filters.flatMap(filter => 
          filter.extensions.map(ext => `.${ext}`)
        )
        console.log('WebDialogService: Generated extensions with dots:', extensions)
        const acceptString = extensions.join(',')
        console.log('WebDialogService: Final accept attribute:', acceptString)
        input.accept = acceptString
      }

      input.onchange = (e) => {
        const files = (e.target as HTMLInputElement).files
        if (!files || files.length === 0) {
          resolve(null)
          return
        }

        if (options?.multiple) {
          resolve(Array.from(files).map(file => file.name))
        } else {
          resolve(files[0].name)
        }
      }

      input.oncancel = () => resolve(null)
      input.click()
    })
  }

  async save(_options?: DialogOpenOptions): Promise<string | null> {
    // Web doesn't support save dialogs in same way
    // Return a default filename or null
    console.warn('Save dialog not supported in web environment')
    return null
  }
}
