/**
 * Threads Service Types
 */

import type { Event } from '@janhq/extension-api'

export interface ThreadsService {
  /** Fires once per thread the backend deleted through `deleteThread`. */
  readonly onDidDeleteThread: Event<{ threadId: string }>
  fetchThreads(): Promise<Thread[]>
  createThread(thread: Thread): Promise<Thread>
  updateThread(thread: Thread): Promise<void>
  deleteThread(threadId: string): Promise<void>
}
