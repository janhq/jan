interface Conversation {
  id: string
  object: string
  title: string
  created_at: number
  project_id?: string
  metadata: {
    is_favorite: string
    model_id: string
    model_provider: string
    search_enabled?: string
    deep_research_enabled?: string
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
  project_id?: string
  metadata: {
    model_id: string
    model_provider: string
    is_favorite?: string
    search_enabled?: string
    deep_research_enabled?: string
  }
}

interface UpdateConversationPayload {
  title?: string
  project_id?: string
  metadata?: {
    model_id?: string
    model_provider?: string
    is_favorite?: string
    search_enabled?: string
    deep_research_enabled?: string
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

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

interface ConversationItemContent {
  type: string
  text?: string & { text?: string }
  input_text?: string
  reasoning_text?: string
  image?: { url: string }
  tool_calls?: Array<ToolCall>
}
