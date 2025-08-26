/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Path Service - Generic implementation with minimal returns
 */

import type { PathService } from './types'

export class DefaultPathService implements PathService {
  sep(): string {
    return '/'
  }

  async join(...segments: string[]): Promise<string> {
    return ''
  }

  async dirname(path: string): Promise<string> {
    return ''
  }

  async basename(path: string): Promise<string> {
    return ''
  }

  async extname(path: string): Promise<string> {
    return ''
  }
}