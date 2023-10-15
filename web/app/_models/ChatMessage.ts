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
  _id?: string;
  conversationId?: string;
  user?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const toChatMessage = async (m: RawMessage): Promise<ChatMessage> => {
  const createdAt = new Date(m.createdAt ?? "").getTime();
  const imageUrls: string[] = [];
  const imageUrl = undefined;
  if (imageUrl) {
    imageUrls.push(imageUrl);
  }

  const messageType = MessageType.Text;
  const messageSenderType =
    m.user === "user" ? MessageSenderType.User : MessageSenderType.Ai;

  const content = m.message ?? "";

  return {
    id: (m._id ?? 0).toString(),
    conversationId: (m.conversationId ?? 0).toString(),
    messageType: messageType,
    messageSenderType: messageSenderType,
    senderUid: m.user?.toString() || "0",
    senderName: m.user === "user" ? "You" : "Assistant",
    senderAvatarUrl:
      m.user === "user" ? "icons/avatar.svg" : "icons/app_icon.svg",
    text: content,
    imageUrls: imageUrls,
    createdAt: createdAt,
    status: MessageStatus.Ready,
  };
};
