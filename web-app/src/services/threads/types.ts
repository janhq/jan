/**
 * Threads Service Types
 */

export interface ThreadsService {
  fetchThreads(): Promise<Thread[]>
  createThread(thread: Thread): Promise<Thread>
  updateThread(thread: Thread): Promise<void>
  deleteThread(threadId: string): Promise<void>
}
