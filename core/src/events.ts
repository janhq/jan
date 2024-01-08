// TODO: refactor EventName to use the events defined in /types
/**
 * The `EventName` enumeration contains the names of all the available events in the Jan platform.
 */
export enum EventName {
  /** The `OnMessageSent` event is emitted when a message is sent. */
  OnMessageSent = 'OnMessageSent',
  /** The `OnMessageResponse` event is emitted when a message is received. */
  OnMessageResponse = 'OnMessageResponse',
  /** The `OnMessageUpdate` event is emitted when a message is updated. */
  OnMessageUpdate = 'OnMessageUpdate',
  /** The `OnModelInit` event is emitted when a model inits. */
  OnModelInit = 'OnModelInit',
  /** The `OnModelReady` event is emitted when a model ready. */
  OnModelReady = 'OnModelReady',
  /** The `OnModelFail` event is emitted when a model fails loading. */
  OnModelFail = 'OnModelFail',
  /** The `OnModelStop` event is emitted when a model start to stop. */
  OnModelStop = 'OnModelStop',
  /** The `OnModelStopped` event is emitted when a model stopped ok. */
  OnModelStopped = 'OnModelStopped',
  /** The `OnInferenceStopped` event is emitted when a inference is stopped. */
  OnInferenceStopped = 'OnInferenceStopped',
  /** The `OnThreadStarted` event is emitted when a thread is started. */
  OnThreadStarted = 'OnThreadStarted'
}

/**
 * Adds an observer for an event.
 *
 * @param eventName The name of the event to observe.
 * @param handler The handler function to call when the event is observed.
 */
const on: (eventName: string, handler: Function) => void = (eventName, handler) => {
  global.core?.events?.on(eventName, handler)
}

/**
 * Removes an observer for an event.
 *
 * @param eventName The name of the event to stop observing.
 * @param handler The handler function to call when the event is observed.
 */
const off: (eventName: string, handler: Function) => void = (eventName, handler) => {
  global.core?.events?.off(eventName, handler)
}

/**
 * Emits an event.
 *
 * @param eventName The name of the event to emit.
 * @param object The object to pass to the event callback.
 */
const emit: (eventName: string, object: any) => void = (eventName, object) => {
  global.core?.events?.emit(eventName, object)
}

export const events = {
  on,
  off,
  emit,
}
