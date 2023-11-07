import { NewMessageResponse } from '@janhq/core'
import { Message } from '@janhq/core/lib/types'
export enum MessageType {
  Text = 'Text',
  Image = 'Image',
  ImageWithText = 'ImageWithText',
  Error = 'Error',
}

export enum MessageSenderType {
  Ai = 'assistant',
  User = 'user',
}

export enum MessageStatus {
  Ready = 'ready',
  Pending = 'pending',
}

export interface ChatMessage {
  id: string
  conversationId: string
  messageType: MessageType
  messageSenderType: MessageSenderType
  senderUid: string
  senderName: string
  senderAvatarUrl: string
  text: string | undefined
  imageUrls?: string[] | undefined
  createdAt: number
  status: MessageStatus
}

export interface RawMessage {
  _id?: string
  conversationId?: string
  user?: string
  avatar?: string
  message?: string
  createdAt?: string
  updatedAt?: string
}

export const toChatMessage = (
  m: RawMessage | Message | NewMessageResponse,
  bot?: Bot,
  conversationId?: string
): ChatMessage => {
  const createdAt = new Date(m.createdAt ?? '').getTime()
  const imageUrls: string[] = []
  const imageUrl = undefined
  if (imageUrl) {
    imageUrls.push(imageUrl)
  }

  const messageType = MessageType.Text
  const messageSenderType =
    m.user === 'user' ? MessageSenderType.User : MessageSenderType.Ai

  const content = m.message ?? ''

  let senderName = m.user === 'user' ? 'You' : 'Assistant'
  if (senderName === 'Assistant' && bot) {
    senderName = bot.name
  }

  return {
    id: (m._id ?? 0).toString(),
    conversationId: (
      (m as RawMessage | NewMessageResponse)?.conversationId ??
      conversationId ??
      0
    ).toString(),
    messageType: messageType,
    messageSenderType: messageSenderType,
    senderUid: m.user?.toString() || '0',
    senderName: senderName,
    senderAvatarUrl:
      m.user === 'user' ? 'icons/avatar.svg' : 'icons/app_icon.svg',
    text: content,
    imageUrls: imageUrls,
    createdAt: createdAt,
    status: MessageStatus.Ready,
  }
}
