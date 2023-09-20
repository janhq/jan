import { MessageDetailFragment } from "@/graphql";
import { remark } from "remark";
import html from "remark-html";

export enum MessageType {
  Text = "Text",
  Image = "Image",
  ImageWithText = "ImageWithText",
  Error = "Error",
}

export enum MessageSenderType {
  Ai = "Ai",
  User = "User",
}

export enum MessageStatus {
  Ready = "ready",
  Pending = "pending",
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  messageType: MessageType;
  messageSenderType: MessageSenderType;
  senderUid: string;
  senderName: string;
  senderAvatarUrl: string;
  text: string | undefined;
  imageUrls?: string[] | undefined;
  createdAt: number;
  status: MessageStatus;
}

export interface RawMessage {
  id: string;
  conversation_id: string;
  user?: string;
  message?: string;
  created_at?: string;
  updated_at?: string;
}

export const toChatMessage = async (m: RawMessage): Promise<ChatMessage> => {
  const createdAt = new Date(m.created_at ?? "").getTime();
  const imageUrls: string[] = [];
  const imageUrl = undefined;
  // m.message_medias.length > 0 ? m.message_medias[0].media_url : null;
  if (imageUrl) {
    imageUrls.push(imageUrl);
  }

  const messageType = MessageType.Text;
  // m.message_type ? MessageType[m.message_type as keyof typeof MessageType] : MessageType.Text;
  const messageSenderType =
    m.user === "user" ? MessageSenderType.User : MessageSenderType.Ai;
  // m.message_sender_type
  //   ? MessageSenderType[m.message_sender_type as keyof typeof MessageSenderType]
  //   : MessageSenderType.Ai;

  const content = m.message ?? "";
  const processedContent = await remark().use(html).process(content);
  const contentHtml = processedContent.toString();

  return {
    id: m.id,
    conversationId: m.conversation_id,
    messageType: messageType,
    messageSenderType: messageSenderType,
    senderUid: m.user?.toString() || "0",
    senderName: m.user === "user" ? "You" : "Jan", // m.sender_name ?? "",
    senderAvatarUrl: "icons/app_icon.svg", // m.sender_avatar_url ?? "icons/app_icon.svg",
    text: contentHtml,
    imageUrls: imageUrls,
    createdAt: createdAt,
    status: MessageStatus.Ready,
    // status: m.status as MessageStatus,
  };
};
