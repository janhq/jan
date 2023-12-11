/**
 * The `BaseEvent` class is the base class for all events in the Jan platform.
 * It provides default, overridable, implementations for event methods.
 */
export abstract class BaseEvent {
  /**
   * Adds an observer for an event.
   *
   * @param eventName The name of the event to observe.
   * @param handler The handler function to call when the event is observed.
   */
  on: (eventName: string, handler: Function) => void = (eventName, handler) => {
    global.core?.events?.on(eventName, handler)
  }

  /**
   * Removes an observer for an event.
   *
   * @param eventName The name of the event to stop observing.
   * @param handler The handler function to call when the event is observed.
   */
  off: (eventName: string, handler: Function) => void = (eventName, handler) => {
    global.core?.events?.off(eventName, handler)
  }

  /**
   * Emits an event.
   *
   * @param eventName The name of the event to emit.
   * @param object The object to pass to the event callback.
   */
  emit: (eventName: string, object: any) => void = (eventName, object) => {
    global.core?.events?.emit(eventName, object)
  }
}
