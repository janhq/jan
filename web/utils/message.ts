import {
  ChatMessage,
  Message,
  MessageSenderType,
  MessageStatus,
  MessageType,
  NewMessageResponse,
  RawMessage,
} from '@janhq/core'

export const toChatMessage = (
  m: RawMessage | Message | NewMessageResponse,
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

  const senderName = m.user === 'user' ? 'You' : 'Assistant'

  return {
    id: (m.id ?? 0).toString(),
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
