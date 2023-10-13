export interface Conversation {
  id?: string;
  model_id?: string;
  name?: string;
  image?: string;
  message?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Store the state of conversation like fetching, waiting for response, etc.
 */
export type ConversationState = {
  hasMore: boolean;
  waitingForResponse: boolean;
  error?: Error;
};
