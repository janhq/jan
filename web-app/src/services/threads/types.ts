import type { ConversationCapabilitiesV1 } from '@/lib/conversationCapabilities'

/**
 * Threads Service Types
 */

export interface ThreadsService {
  setConversationCapabilities(threadId: string, value: ConversationCapabilitiesV1): Promise<void>
  fetchThreads(): Promise<Thread[]>
  createThread(thread: Thread, options?: { strict?: boolean }): Promise<Thread>
  updateThread(thread: Thread): Promise<void>
  rollbackCreatedThread(threadId: string, receipt: Thread): Promise<void>
  releaseCreatedThread(receipt: Thread): void
  deleteThread(threadId: string): Promise<void>
}
