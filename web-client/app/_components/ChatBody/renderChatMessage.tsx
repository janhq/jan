import SimpleControlNetMessage from "../SimpleControlNetMessage";
import SimpleImageMessage from "../SimpleImageMessage";
import SimpleTextMessage from "../SimpleTextMessage";
import { ChatMessage, MessageStatus, MessageType } from "@/_models/ChatMessage";
import StreamTextMessage from "../StreamTextMessage";

export default function renderChatMessage({
  id,
  conversationId,
  messageType,
  senderAvatarUrl,
  senderName,
  createdAt,
  imageUrls,
  text,
  status,
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
          text={text ?? ""}
        />
      );
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
      );
    case MessageType.Text:
      return status === MessageStatus.Ready ? (
        <SimpleTextMessage
          key={id}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          text={text}
        />
      ) : (
        <StreamTextMessage
          key={id}
          id={id}
          convoId={conversationId}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          text={text}
        />
      );
    default:
      return null;
  }
}
