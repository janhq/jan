/**
 * Default Events Service - Generic implementation with minimal returns
 */

import type { EventsService, EventOptions, UnlistenFn } from './types'

export class DefaultEventsService implements EventsService {
  async emit<T>(event: string, payload?: T, options?: EventOptions): Promise<void> {
    console.log('event emit called:', { event, payload, options })
    // No-op - not implemented in default service
  }

  async listen<T>(event: string, handler: (event: { payload: T }) => void, options?: EventOptions): Promise<UnlistenFn> {
    console.log('event listen called:', { event, handlerType: typeof handler, options })
    return () => {
      // No-op unlisten function
    }
  }
}
