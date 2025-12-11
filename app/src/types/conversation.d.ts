interface Conversation {
  id: string
  object: string
  title: string
  created_at: number
  metadata: {
    is_favorite: string
    model_id: string
    model_provider: string
  }
}

interface ConversationsResponse {
  object: string
  data: Conversation[]
  first_id: string
  last_id: string
  has_more: boolean
  total: number
}

interface CreateConversationPayload {
  title: string
  metadata: {
    model_id: string
    model_provider: string
    is_favorite?: string
  }
}

interface ConversationItemsResponse {
  object: string
  data: ConversationItem[]
  first_id: string
  last_id: string
  has_more: boolean
  total: number
}

interface ConversationItem {
  id: string
  object: string
  role: string
  content: ConversationItemContent[]
  created_at: number
}

interface ConversationItemContent {
  type: string
  text?: string & { text?: string }
  input_text?: string
  reasoning_content?: string
}