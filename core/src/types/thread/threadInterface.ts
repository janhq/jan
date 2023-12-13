import { Thread } from './threadEntity'

/**
 * Conversational extension. Persists and retrieves conversations.
 * @abstract
 * @extends BaseExtension
 */
export interface ThreadInterface {
  /**
   * Returns a list of thread.
   * @abstract
   * @returns {Promise<Thread[]>} A promise that resolves to an array of threads.
   */
  getThreads(): Promise<Thread[]>

  /**
   * Saves a thread.
   * @abstract
   * @param {Thread} thread - The thread to save.
   * @returns {Promise<void>} A promise that resolves when the thread is saved.
   */
  saveThread(thread: Thread): Promise<void>

  /**
   * Deletes a thread.
   * @abstract
   * @param {string} threadId - The ID of the thread to delete.
   * @returns {Promise<void>} A promise that resolves when the thread is deleted.
   */
  deleteThread(threadId: string): Promise<void>
}
