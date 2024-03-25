/**
 * Adds an observer for an event.
 *
 * @param eventName The name of the event to observe.
 * @param handler The handler function to call when the event is observed.
 */
const on: (eventName: string, handler: Function) => void = (eventName, handler) => {
  globalThis.core?.events?.on(eventName, handler)
}

/**
 * Removes an observer for an event.
 *
 * @param eventName The name of the event to stop observing.
 * @param handler The handler function to call when the event is observed.
 */
const off: (eventName: string, handler: Function) => void = (eventName, handler) => {
  globalThis.core?.events?.off(eventName, handler)
}

/**
 * Emits an event.
 *
 * @param eventName The name of the event to emit.
 * @param object The object to pass to the event callback.
 */
const emit: (eventName: string, object: any) => void = (eventName, object) => {
  globalThis.core?.events?.emit(eventName, object)
}

export const events = {
  on,
  off,
  emit,
}
