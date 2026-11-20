import type { Disposable } from './disposable.js'

/** Subscribes a listener; dispose the result to unsubscribe. */
export type Event<T> = (listener: (e: T) => void) => Disposable

/** The producing side of an `Event`. */
export class Emitter<T> {
  // Wrapped in objects so one function subscribed twice is two subscriptions.
  private listeners = new Set<{ fn: (e: T) => void }>()

  readonly event: Event<T> = (fn) => {
    const entry = { fn }
    this.listeners.add(entry)
    return { dispose: () => void this.listeners.delete(entry) }
  }

  /**
   * Delivers `e` to every current listener. A throwing listener is reported
   * and skipped, so one subscriber cannot starve the others.
   */
  fire(e: T): void {
    for (const { fn } of [...this.listeners]) {
      try {
        fn(e)
      } catch (error) {
        console.error('Event listener failed:', error)
      }
    }
  }

  /** Drops every listener. */
  dispose(): void {
    this.listeners.clear()
  }
}
