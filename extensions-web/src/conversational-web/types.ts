/**
 * TypeScript Types for Conversational API
 */

export interface PaginationParams {
  limit?: number
  after?: string
  order?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  has_more: boolean
  object: 'list'
  first_id?: string
  last_id?: string
}

export interface ConversationMetadata {
  model_provider?: string
  model_id?: string
  is_favorite?: string
}

export interface Conversation {
  title?: string
  metadata?: ConversationMetadata
}

export interface ConversationResponse {
  id: string
  object: 'conversation'
  title?: string
  created_at: number
  metadata: ConversationMetadata
}

export type ListConversationsParams = PaginationParams
export type ListConversationsResponse = PaginatedResponse<ConversationResponse>
