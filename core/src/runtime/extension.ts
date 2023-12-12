// TODO(Nicole): Figure how to move this to the right place
// Should we do extension names or ids?
// Are extension names reserved? It is currently used by web/ExtensionManager as the key...
export enum ExtensionType {
  Assistant = 'assistant',
  Conversational = 'conversational',
  Inference = 'inference',
  Model = 'model',
  SystemMonitoring = 'systemMonitoring',
}

/**
 * Represents a base extension.
 * This class should be extended by any class that represents an extension.
 * Needs to be abstract class (not interface) because extensions are inherited at runtime.
 */
export abstract class BaseExtension {
  // Lifecycle management
  /**
   * Returns the type of the extension.
   * @returns {ExtensionType} The type of the extension
   * Undefined means its not extending any known extension by the application.
   */
  abstract type(): string | undefined
  /**
   * Called when the extension is loaded.
   * Any initialization logic for the extension should be put here.
   */
  abstract onLoad(): void
  /**
   * Called when the extension is unloaded.
   * Any cleanup logic for the extension should be put here.
   */
  abstract onUnload(): void

  // Event handling
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

  // TODO: registerView, registerSettings,
}
