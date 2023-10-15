export interface Conversation {
  _id?: string;
  modelId?: string;
  name?: string;
  image?: string;
  message?: string;
  lastMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Store the state of conversation like fetching, waiting for response, etc.
 */
export type ConversationState = {
  hasMore: boolean;
  waitingForResponse: boolean;
  error?: Error;
};
