enum MessageType {
  Text = 'Text',
  Image = 'Image',
  ImageWithText = 'ImageWithText',
  Error = 'Error',
}

enum MessageSenderType {
  Ai = 'assistant',
  User = 'user',
}

enum MessageStatus {
  Ready = 'ready',
  Pending = 'pending',
}

interface ChatMessage {
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

interface RawMessage {
  _id?: string
  conversationId?: string
  user?: string
  avatar?: string
  message?: string
  createdAt?: string
  updatedAt?: string
}

interface Conversation {
  _id?: string
  modelId?: string
  name?: string
  image?: string
  message?: string
  lastMessage?: string
  summary?: string
  createdAt?: string
  updatedAt?: string
  botId?: string
}

/**
 * Store the state of conversation like fetching, waiting for response, etc.
 */
type ConversationState = {
  hasMore: boolean
  waitingForResponse: boolean
  error?: Error
}
