/**
 * Default Dialog Service - Generic implementation with minimal returns
 */

import type { DialogService } from './types'

export class DefaultDialogService implements DialogService {
  async open(): Promise<string | string[] | null> {
    return null
  }

  async save(): Promise<string | null> {
    return null
  }
}
