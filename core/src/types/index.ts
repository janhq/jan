export interface Conversation {
  id: string;
  modelId?: string;
  botId?: string;
  name: string;
  message?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: Message[];
  lastMessage?: string;
}

export interface Message {
  id: string;
  message?: string;
  user?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RawMessage {
  id?: string;
  conversationId?: string;
  user?: string;
  avatar?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Model {
  /**
   * Combination of owner and model name.
   * Being used as file name. MUST be unique.
   */
  id: string;
  name: string;
  quantMethod: string;
  bits: number;
  size: number;
  maxRamRequired: number;
  usecase: string;
  downloadLink: string;
  modelFile?: string;
  /**
   * For tracking download info
   */
  startDownloadAt?: number;
  finishDownloadAt?: number;
  productId: string;
  productName: string;
  shortDescription: string;
  longDescription: string;
  avatarUrl: string;
  author: string;
  version: string;
  modelUrl: string;
  createdAt: number;
  updatedAt?: number;
  status: string;
  releaseDate: number;
  tags: string[];
}
export interface ModelCatalog {
  id: string;
  name: string;
  shortDescription: string;
  avatarUrl: string;
  longDescription: string;
  author: string;
  version: string;
  modelUrl: string;
  createdAt: number;
  updatedAt?: number;
  status: string;
  releaseDate: number;
  tags: string[];
  availableVersions: ModelVersion[];
}
/**
 * Model type which will be stored in the database
 */
export type ModelVersion = {
  /**
   * Combination of owner and model name.
   * Being used as file name. Should be unique.
   */
  id: string;
  name: string;
  quantMethod: string;
  bits: number;
  size: number;
  maxRamRequired: number;
  usecase: string;
  downloadLink: string;
  productId: string;
  /**
   * For tracking download state
   */
  startDownloadAt?: number;
  finishDownloadAt?: number;
};

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

export enum MessageType {
  Text = "Text",
  Image = "Image",
  ImageWithText = "ImageWithText",
  Error = "Error",
}

export enum MessageSenderType {
  Ai = "assistant",
  User = "user",
}

export enum MessageStatus {
  Ready = "ready",
  Pending = "pending",
}

export type ConversationState = {
  hasMore: boolean;
  waitingForResponse: boolean;
  error?: Error;
};
