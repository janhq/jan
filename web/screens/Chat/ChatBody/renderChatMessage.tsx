import SimpleControlNetMessage from '../../../components/SimpleControlNetMessage'
import SimpleImageMessage from '../../../components/SimpleImageMessage'
import SimpleTextMessage from '../../../components/SimpleTextMessage'

import { ChatMessage, MessageType } from '@/models/ChatMessage'

export default function renderChatMessage({
  id,
  messageType,
  messageSenderType,
  senderAvatarUrl,
  senderName,
  createdAt,
  imageUrls,
  text,
}: ChatMessage): React.ReactNode {
  switch (messageType) {
    case MessageType.ImageWithText:
      return (
        <SimpleControlNetMessage
          key={id}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          imageUrls={imageUrls ?? []}
          text={text ?? ''}
        />
      )
    case MessageType.Image:
      return (
        <SimpleImageMessage
          key={id}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          imageUrls={imageUrls ?? []}
          text={text}
        />
      )
    case MessageType.Text:
      return (
        <SimpleTextMessage
          key={id}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          senderType={messageSenderType}
          text={text}
        />
      )
    default:
      return null
  }
}
