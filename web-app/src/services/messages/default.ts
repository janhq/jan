/**
 * Default Messages Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import {
  ConversationalExtension,
  ExtensionTypeEnum,
  ThreadMessage,
} from '@janhq/core'
import type { MessagesService } from './types'

export class DefaultMessagesService implements MessagesService {
  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    return (
      ExtensionManager.getInstance()
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.listMessages(threadId)
        ?.catch(() => []) ?? []
    )
  }

  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    return (
      ExtensionManager.getInstance()
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.createMessage(message)
        ?.catch(() => message) ?? message
    )
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    await ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.deleteMessage(threadId, messageId)
  }
}