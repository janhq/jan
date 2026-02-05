/**
 * Default Opener Service - Generic implementation with minimal returns
 */

import type { OpenerService } from './types'

export class DefaultOpenerService implements OpenerService {
  async revealItemInDir(path: string): Promise<void> {
    console.log('revealItemInDir called with path:', path)
    // No-op - not implemented in default service
  }
}
