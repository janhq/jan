/**
 * Tauri Events Service - Desktop implementation
 * 
 * MOVED FROM: src/routes/settings/general.tsx (emit calls), src/routes/local-api-server/logs.tsx (listen calls)
 * NO IMPLEMENTATION CHANGES - EXACT SAME LOGIC MOVED HERE
 */

import { emit, listen } from '@tauri-apps/api/event'
import type { EventOptions, UnlistenFn } from './types'
import { DefaultEventsService } from './default'

export class TauriEventsService extends DefaultEventsService {
  async emit<T>(event: string, payload?: T, options?: EventOptions): Promise<void> {
    try {
      // MOVED FROM settings pages - exact same implementation
      await emit(event, payload)
    } catch (error) {
      console.error('Error emitting Tauri event, falling back to default:', error)
      return super.emit(event, payload, options)
    }
  }

  async listen<T>(event: string, handler: (event: { payload: T }) => void, options?: EventOptions): Promise<UnlistenFn> {
    try {
      // MOVED FROM logs pages - exact same implementation
      const unlisten = await listen<T>(event, handler)
      return unlisten
    } catch (error) {
      console.error('Error listening to Tauri event, falling back to default:', error)
      return super.listen(event, handler, options)
    }
  }
}