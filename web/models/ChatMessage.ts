import { NewMessageResponse } from '@janhq/core'

export const toChatMessage = (
  m: RawMessage | NewMessageResponse
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

  return {
    id: (m._id ?? 0).toString(),
    conversationId: (m.conversationId ?? 0).toString(),
    messageType: messageType,
    messageSenderType: messageSenderType,
    senderUid: m.user?.toString() || '0',
    senderName:
      m.user === 'user'
        ? 'You'
        : m.user && m.user !== 'ai' && m.user !== 'assistant'
        ? m.user
        : 'Assistant',
    senderAvatarUrl: m.avatar
      ? m.avatar
      : m.user === 'user'
      ? 'icons/avatar.svg'
      : 'icons/app_icon.svg',
    text: content,
    imageUrls: imageUrls,
    createdAt: createdAt,
    status: MessageStatus.Ready,
  }
}
