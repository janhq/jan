import type { ConversationCapabilitiesV1 } from '@/lib/conversationCapabilities'

/**
 * Threads Service Types
 */

export interface ThreadsService {
  setConversationCapabilities(threadId: string, value: ConversationCapabilitiesV1): Promise<void>
  fetchThreads(): Promise<Thread[]>
  createThread(thread: Thread): Promise<Thread>
  updateThread(thread: Thread): Promise<void>
  deleteThread(threadId: string): Promise<void>
}
