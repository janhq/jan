/**
 * Tauri Events Service - Desktop implementation
 */

import { emit, listen } from '@tauri-apps/api/event'
import type { EventOptions, UnlistenFn } from './types'
import { DefaultEventsService } from './default'

export class TauriEventsService extends DefaultEventsService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async emit<T>(event: string, payload?: T, _options?: EventOptions): Promise<void> {
    try {
      await emit(event, payload)
    } catch (error) {
      console.error('Error emitting Tauri event:', error)
      throw error
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listen<T>(event: string, handler: (event: { payload: T }) => void, _options?: EventOptions): Promise<UnlistenFn> {
    try {
      const unlisten = await listen<T>(event, handler)
      return unlisten
    } catch (error) {
      console.error('Error listening to Tauri event:', error)
      return () => {}
    }
  }
}
