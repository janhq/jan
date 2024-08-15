import { ThreadMessage } from './messageEntity'

/**
 * Conversational extension. Persists and retrieves conversations.
 * @abstract
 * @extends BaseExtension
 */
export interface MessageInterface {
  /**
   * Adds a new message to the thread.
   * @param {ThreadMessage} message - The message to be added.
   * @returns {Promise<void>} A promise that resolves when the message has been added.
   */
  addNewMessage(message: ThreadMessage): Promise<void>

  /**
   * Writes an array of messages to a specific thread.
   * @param {string} threadId - The ID of the thread to write the messages to.
   * @param {ThreadMessage[]} messages - The array of messages to be written.
   * @returns {Promise<void>} A promise that resolves when the messages have been written.
   */
  writeMessages(threadId: string, messages: ThreadMessage[]): Promise<void>

  /**
   * Retrieves all messages from a specific thread.
   * @param {string} threadId - The ID of the thread to retrieve the messages from.
   * @returns {Promise<ThreadMessage[]>} A promise that resolves to an array of messages from the thread.
   */
  getAllMessages(threadId: string): Promise<ThreadMessage[]>
}
