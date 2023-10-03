import SimpleControlNetMessage from "../SimpleControlNetMessage";
import SimpleImageMessage from "../SimpleImageMessage";
import SimpleTextMessage from "../SimpleTextMessage";
import { ChatMessage, MessageType } from "@/_models/ChatMessage";
import StreamTextMessage from "../StreamTextMessage";
import { useAtomValue } from "jotai";
import { currentStreamingMessageAtom } from "@/_helpers/atoms/ChatMessage.atom";

export default function renderChatMessage({
  id,
  messageType,
  senderAvatarUrl,
  senderName,
  createdAt,
  imageUrls,
  htmlText,
  text,
}: ChatMessage): React.ReactNode {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const message = useAtomValue(currentStreamingMessageAtom);
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
      return id !== message?.id ? (
        <SimpleTextMessage
          key={id}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          text={htmlText && htmlText.trim().length > 0 ? htmlText : text}
        />
      ) : (
        <StreamTextMessage
          key={id}
          id={id}
          avatarUrl={senderAvatarUrl}
          senderName={senderName}
          createdAt={createdAt}
          text={htmlText && htmlText.trim().length > 0 ? htmlText : text}
        />
      );
    default:
      return null;
  }
}
