interface Conversation {
  id: string
  object: string
  title: string
  created_at: number
  project_id?: string
  active_branch?: string
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
  items?: CreateItemRequest[]
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
  branch?: string
  sequence_number?: number
  type?: string
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

  // Tool result fields
  mcp_call?: string | unknown
  tool_result?: string | unknown

  // Share snapshot format for files/images (file_ref instead of image.url)
  file_ref?: {
    file_id: string
    mime_type?: string
    name?: string
    url?: string // Presigned URL from server (for public access)
  }
}

// Branch types
interface ConversationBranch {
  name: string
  description?: string
  parent_branch?: string
  forked_at?: number
  forked_from_item_id?: string
  item_count: number
  created_at: number
  updated_at: number
  is_active: boolean
}

interface ListBranchesResponse {
  object: string
  data: ConversationBranch[]
  active_branch: string
}

interface EditMessageRequest {
  content: string
  regenerate?: boolean
}

interface EditMessageResponse {
  branch: string // Always "MAIN" after swap
  old_main_backup: string // Backup name for old MAIN
  branch_created: boolean
  new_branch?: ConversationBranch
  user_item: ConversationItem
}

interface RegenerateMessageRequest {
  model?: string
  temperature?: number
  max_tokens?: number
}

interface RegenerateMessageResponse {
  branch: string // Always "MAIN" after swap
  old_main_backup: string // Backup name for old MAIN
  branch_created: boolean
  new_branch?: ConversationBranch
  user_item_id: string
}

interface DeleteItemResponse {
  branch: string // Always "MAIN" after swap
  old_main_backup: string // Backup name for old MAIN
  branch_created: boolean
  deleted: boolean
}

interface CreateItemRequest {
  role: string
  content: ConversationItemContent[]
  type?: string
}

interface ActivateBranchResponse {
  active_branch: string
  message: string
}

interface CreateBranchRequest {
  name: string
  parent_branch?: string
  fork_from_item_id?: string
  description?: string
}
