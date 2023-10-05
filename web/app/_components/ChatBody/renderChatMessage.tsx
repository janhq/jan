import SimpleControlNetMessage from "../SimpleControlNetMessage";
import SimpleImageMessage from "../SimpleImageMessage";
import SimpleTextMessage from "../SimpleTextMessage";
import { ChatMessage, MessageType } from "@/_models/ChatMessage";

export default function renderChatMessage({
  id,
  messageType,
  messageSenderType,
  senderAvatarUrl,
  senderName,
  createdAt,
  imageUrls,
  htmlText,
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
      return (
        <SimpleTextMessage
          key={id}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          senderType={messageSenderType}
          text={htmlText && htmlText.trim().length > 0 ? htmlText : text}
        />
      );
    default:
      return null;
  }
}
