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
  createMessage(message: ThreadMessage): Promise<ThreadMessage>

  /**
   * Retrieves all messages from a specific thread.
   * @param {string} threadId - The ID of the thread to retrieve the messages from.
   * @returns {Promise<ThreadMessage[]>} A promise that resolves to an array of messages from the thread.
   */
  listMessages(threadId: string): Promise<ThreadMessage[]>

  /**
   * Updates an existing message in a thread.
   * @param {ThreadMessage} message - The message to be updated (must have existing ID).
   * @returns {Promise<ThreadMessage>} A promise that resolves to the updated message.
   */
  modifyMessage(message: ThreadMessage): Promise<ThreadMessage>

  /**
   * Deletes a specific message from a thread.
   * @param {string} threadId - The ID of the thread from which the message will be deleted.
   * @param {string} messageId - The ID of the message to be deleted.
   * @returns {Promise<void>} A promise that resolves when the message has been successfully deleted.
   */
  deleteMessage(threadId: string, messageId: string): Promise<void>
}
