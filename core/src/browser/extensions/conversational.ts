import {
  Thread,
  ThreadInterface,
  ThreadMessage,
  MessageInterface,
  ThreadAssistantInfo,
} from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'

/**
 * Conversational extension. Persists and retrieves conversations.
 * @abstract
 * @extends BaseExtension
 */
export abstract class ConversationalExtension
  extends BaseExtension
  implements ThreadInterface, MessageInterface
{
  /**
   * Conversation extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Conversational
  }

  abstract listThreads(): Promise<Thread[]>
  abstract createThread(thread: Partial<Thread>): Promise<Thread>
  abstract modifyThread(thread: Thread): Promise<void>
  abstract deleteThread(threadId: string): Promise<void>
  abstract createMessage(message: Partial<ThreadMessage>): Promise<ThreadMessage>
  abstract deleteMessage(threadId: string, messageId: string): Promise<void>
  abstract listMessages(threadId: string): Promise<ThreadMessage[]>
  abstract getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo>
  abstract createThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo>
  abstract modifyThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo>
  abstract modifyMessage(message: ThreadMessage): Promise<ThreadMessage>
}
