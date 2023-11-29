import { Thread, ThreadMessage } from "../index";
import { JanPlugin } from "../plugin";

/**
 * Abstract class for Thread plugins.
 * @abstract
 * @extends JanPlugin
 */
export abstract class ConversationalPlugin extends JanPlugin {
  /**
   * Returns a list of thread.
   * @abstract
   * @returns {Promise<Thread[]>} A promise that resolves to an array of threads.
   */
  abstract getThreads(): Promise<Thread[]>;

  /**
   * Saves a thread.
   * @abstract
   * @param {Thread} thread - The thread to save.
   * @returns {Promise<void>} A promise that resolves when the thread is saved.
   */
  abstract saveThread(thread: Thread): Promise<void>;

  /**
   * Deletes a thread.
   * @abstract
   * @param {string} threadId - The ID of the thread to delete.
   * @returns {Promise<void>} A promise that resolves when the thread is deleted.
   */
  abstract deleteThread(threadId: string): Promise<void>;

  /**
   * Adds a new message to the thread.
   * @param {ThreadMessage} message - The message to be added.
   * @returns {Promise<void>} A promise that resolves when the message has been added.
   */
  abstract addNewMessage(message: ThreadMessage): Promise<void>;

  /**
   * Writes an array of messages to a specific thread.
   * @param {string} threadId - The ID of the thread to write the messages to.
   * @param {ThreadMessage[]} messages - The array of messages to be written.
   * @returns {Promise<void>} A promise that resolves when the messages have been written.
   */
  abstract writeMessages(
    threadId: string,
    messages: ThreadMessage[]
  ): Promise<void>;

  /**
   * Retrieves all messages from a specific thread.
   * @param {string} threadId - The ID of the thread to retrieve the messages from.
   * @returns {Promise<ThreadMessage[]>} A promise that resolves to an array of messages from the thread.
   */
  abstract getAllMessages(threadId: string): Promise<ThreadMessage[]>;
}
