/**
 * Default Path Service - Generic implementation with minimal returns
 */

import type { PathService } from './types'

export class DefaultPathService implements PathService {
  sep(): string {
    return '/'
  }

  async join(...segments: string[]): Promise<string> {
    console.log('path.join called with segments:', segments)
    return ''
  }

  async dirname(path: string): Promise<string> {
    console.log('path.dirname called with path:', path)
    return ''
  }

  async basename(path: string): Promise<string> {
    console.log('path.basename called with path:', path)
    return ''
  }

  async extname(path: string): Promise<string> {
    console.log('path.extname called with path:', path)
    return ''
  }
}
