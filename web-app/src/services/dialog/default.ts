/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Dialog Service - Generic implementation with minimal returns
 */

import type { DialogService, DialogOpenOptions } from './types'

export class DefaultDialogService implements DialogService {
  async open(options?: DialogOpenOptions): Promise<string | string[] | null> {
    return null
  }

  async save(options?: DialogOpenOptions): Promise<string | null> {
    return null
  }
}