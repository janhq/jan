/**
 * Fallback agent service for non-desktop platforms, where the in-process agent
 * loop is unavailable. `run` rejects so callers surface a clear error.
 */

import type { AgentService } from './types'

export class DefaultAgentService implements AgentService {
  async run(): Promise<void> {
    throw new Error('Agent service is only available in the desktop app')
  }

  async cancel(): Promise<void> {
    console.debug('DefaultAgentService.cancel: no desktop backend, nothing to cancel')
  }
}
