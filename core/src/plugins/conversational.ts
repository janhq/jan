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

  abstract addNewMessage(message: ThreadMessage): Promise<void>;

  abstract getAllMessages(threadId: string): Promise<ThreadMessage[]>;
}
