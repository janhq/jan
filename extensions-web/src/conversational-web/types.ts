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
  created_at: number | string
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
  type?: string
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
  image_file?: {
    file_id?: string
    mime_type?: string
  }
  input_text?: string
  output_text?: {
    annotations?: ConversationItemAnnotation[]
    text?: string
  }
  text?: {
    value?: string
    text?: string
  }
  reasoning_content?: string
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
  tool_call_id?: string
  tool_result?: {
    content?: Array<{
      type?: string
      text?: string
      output_text?: {
        text?: string
      }
    }>
    output_text?: {
      text?: string
    }
  }
  text_result?: string
}

export interface ConversationItem {
  content?: ConversationItemContent[]
  created_at: number | string
  id: string
  object: string
  metadata?: Record<string, unknown>
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
