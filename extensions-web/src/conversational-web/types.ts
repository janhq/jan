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

// Conversation Items types
export interface ConversationItemAnnotation {
  end_index?: number
  file_id?: string
  index?: number
  start_index?: number
  text?: string
  type?: string
  url?: string
}

export interface ConversationItemContent {
  file?: {
    file_id?: string
    mime_type?: string
    name?: string
    size?: number
  }
  finish_reason?: string
  image?: {
    detail?: string
    file_id?: string
    url?: string
  }
  input_text?: string
  output_text?: {
    annotations?: ConversationItemAnnotation[]
    text?: string
  }
  reasoning_content?: string
  text?: {
    value?: string
  }
  type?: string
}

export interface ConversationItem {
  content?: ConversationItemContent[]
  created_at: number
  id: string
  object: string
  role: string
  status?: string
  type?: string
}

export interface ListConversationItemsParams extends PaginationParams {
  conversation_id: string
}

export interface ListConversationItemsResponse extends PaginatedResponse<ConversationItem> {
  total?: number
}
