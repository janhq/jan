/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Web Events Service - Web implementation using EventTarget
 */

import type { EventsService, EventOptions, UnlistenFn } from './types'

export class WebEventsService implements EventsService {
  private eventTarget = new EventTarget()

  async emit<T>(event: string, payload?: T, _options?: EventOptions): Promise<void> {
    console.log('Emitting event in web mode:', event, payload)
    
    const customEvent = new CustomEvent(event, {
      detail: { payload }
    })
    
    this.eventTarget.dispatchEvent(customEvent)
  }

  async listen<T>(event: string, handler: (event: { payload: T }) => void, _options?: EventOptions): Promise<UnlistenFn> {
    console.log('Listening to event in web mode:', event)
    
    const eventListener = (e: Event) => {
      const customEvent = e as CustomEvent
      handler({ payload: customEvent.detail?.payload })
    }
    
    this.eventTarget.addEventListener(event, eventListener)
    
    return () => {
      this.eventTarget.removeEventListener(event, eventListener)
    }
  }
}
