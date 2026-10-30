import { DownloadEvent, events } from '@janhq/core'
import type { EventsService, UnlistenFn } from '@/services/events/types'

/** What the download manager sends when it starts checking a model's files. */
export interface ModelValidationStarted {
  modelId: string
  downloadType: string
}

/**
 * Relays the download manager's `onModelValidationStarted` (emitted by
 * `src-tauri/src/core/downloads/helpers.rs`) onto the core event bus, where
 * `useDownloadEvents` turns it into the "validating" toast. The Rust event name
 * and the core one are the same string by contract.
 */
export function bridgeModelValidationStarted(
  hostEvents: Pick<EventsService, 'listen'>
): Promise<UnlistenFn> {
  return hostEvents.listen<ModelValidationStarted>(
    DownloadEvent.onModelValidationStarted,
    (event) => events.emit(DownloadEvent.onModelValidationStarted, event.payload)
  )
}
