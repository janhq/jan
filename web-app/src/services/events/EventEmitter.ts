/**
 * EventEmitter class for backward compatibility
 * Used by ExtensionProvider to set window.core.events
 */

export class EventEmitter extends EventTarget {
  emit(event: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(event, { detail }))
  }

  on(event: string, handler: EventListener) {
    this.addEventListener(event, handler)
  }

  off(event: string, handler: EventListener) {
    this.removeEventListener(event, handler)
  }
}