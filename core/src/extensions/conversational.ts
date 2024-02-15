import { Thread, ThreadInterface, ThreadMessage, MessageInterface } from '../index'
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

  abstract getThreads(): Promise<Thread[]>
  abstract saveThread(thread: Thread): Promise<void>
  abstract deleteThread(threadId: string): Promise<void>
  abstract addNewMessage(message: ThreadMessage): Promise<void>
  abstract writeMessages(threadId: string, messages: ThreadMessage[]): Promise<void>
  abstract getAllMessages(threadId: string): Promise<ThreadMessage[]>
}
