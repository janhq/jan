import { ExtensionManager } from '@/lib/extension'
import {
  ConversationalExtension,
  ExtensionTypeEnum,
  ThreadMessage,
} from '@janhq/core'

/**
 * @fileoverview Fetch messages from the extension manager.
 * @param threadId
 * @returns
 */
export const fetchMessages = async (
  threadId: string
): Promise<ThreadMessage[]> => {
  return (
    ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.listMessages(threadId)
      ?.catch(() => []) ?? []
  )
}

/**
 * @fileoverview Create a message using the extension manager.
 * @param message
 * @returns
 */
export const createMessage = async (
  message: ThreadMessage
): Promise<ThreadMessage> => {
  return (
    ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.createMessage(message)
      ?.catch(() => message) ?? message
  )
}

/**
 * @fileoverview Delete a message using the extension manager.
 * @param threadId
 * @param messageID
 * @returns
 */
export const deleteMessage = (threadId: string, messageId: string) => {
  return ExtensionManager.getInstance()
    .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    ?.deleteMessage(threadId, messageId)
}
