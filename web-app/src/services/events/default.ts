/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Events Service - Generic implementation with minimal returns
 */

import type { EventsService, EventOptions, UnlistenFn } from './types'

export class DefaultEventsService implements EventsService {
  async emit<T>(event: string, payload?: T, options?: EventOptions): Promise<void> {
    // No-op
  }

  async listen<T>(event: string, handler: (event: { payload: T }) => void, options?: EventOptions): Promise<UnlistenFn> {
    return () => {
      // No-op unlisten function
    }
  }
}