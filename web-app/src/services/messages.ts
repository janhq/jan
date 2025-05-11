import { ExtensionManager } from '@/lib/extension'
import {
  ConversationalExtension,
  ExtensionTypeEnum,
  ThreadMessage,
} from '@janhq/core'

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
