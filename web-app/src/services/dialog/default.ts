/**
 * Default Dialog Service - Generic implementation with minimal returns
 */

import type { DialogService, DialogOpenOptions } from './types'

export class DefaultDialogService implements DialogService {
  async open(options?: DialogOpenOptions): Promise<string | string[] | null> {
    console.log('dialog.open called with options:', options)
    return null
  }

  async save(options?: DialogOpenOptions): Promise<string | null> {
    console.log('dialog.save called with options:', options)
    return null
  }
}
