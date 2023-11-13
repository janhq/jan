/**
 * The `EventName` enumeration contains the names of all the available events in the Jan platform.
 */
export enum EventName {
  OnNewConversation = "onNewConversation",
  OnNewMessageRequest = "onNewMessageRequest",
  OnNewMessageResponse = "onNewMessageResponse",
  OnMessageResponseUpdate = "onMessageResponseUpdate",
  OnMessageResponseFinished = "onMessageResponseFinished",
  OnDownloadUpdate = "onDownloadUpdate",
  OnDownloadSuccess = "onDownloadSuccess",
  OnDownloadError = "onDownloadError",
}

export type MessageHistory = {
  role: string;
  content: string;
};
/**
 * The `NewMessageRequest` type defines the shape of a new message request object.
 */
export type NewMessageRequest = {
  id?: string;
  conversationId?: string;
  user?: string;
  avatar?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
  history?: MessageHistory[];
};

/**
 * The `NewMessageRequest` type defines the shape of a new message request object.
 */
export type NewMessageResponse = {
  id?: string;
  conversationId?: string;
  user?: string;
  avatar?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Adds an observer for an event.
 *
 * @param eventName The name of the event to observe.
 * @param handler The handler function to call when the event is observed.
 */
const on: (eventName: string, handler: Function) => void = (eventName, handler) => {
  window.corePlugin?.events?.on(eventName, handler);
};

/**
 * Removes an observer for an event.
 *
 * @param eventName The name of the event to stop observing.
 * @param handler The handler function to call when the event is observed.
 */
const off: (eventName: string, handler: Function) => void = (eventName, handler) => {
  window.corePlugin?.events?.off(eventName, handler);
};

/**
 * Emits an event.
 *
 * @param eventName The name of the event to emit.
 * @param object The object to pass to the event callback.
 */
const emit: (eventName: string, object: any) => void = (eventName, object) => {
  window.corePlugin?.events?.emit(eventName, object);
};

export const events = {
  on,
  off,
  emit,
};
