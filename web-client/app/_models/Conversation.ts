export interface Conversation {
  id: string;
  model_id?: string;
  name?: string;
  image?: string;
  message?: string;
  created_at?: number;
  updated_at?: number;
}

/**
 * Store the state of conversation like fetching, waiting for response, etc.
 */
export type ConversationState = {
  hasMore: boolean;
  waitingForResponse: boolean;
};
