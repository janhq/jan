/**
 * TypeScript Types for Conversational API (OpenAI-Compatible)
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
  project_id?: string
}

export interface ConversationResponse {
  id: string
  object: 'conversation'
  title?: string
  created_at: number | string
  metadata: ConversationMetadata
  project_id?: string
}

export type ListConversationsParams = PaginationParams
export type ListConversationsResponse = PaginatedResponse<ConversationResponse>

// ===============================================
// OpenAI-Compatible Conversation Item Types
// ===============================================

// Item Type Enums
export type ItemType = 
  | 'message'
  | 'function_call'
  | 'function_call_output'
  | 'reasoning'
  | 'file_search_call'
  | 'web_search_call'
  | 'image_generation_call'
  | 'computer_call'
  | 'computer_call_output'
  | 'code_interpreter_call'
  | 'local_shell_call'
  | 'local_shell_call_output'
  | 'shell_call'
  | 'shell_call_output'
  | 'apply_patch_call'
  | 'apply_patch_call_output'
  | 'mcp_list_tools'
  | 'mcp_approval_request'
  | 'mcp_approval_response'
  | 'mcp_call'
  | 'custom_tool_call'
  | 'custom_tool_call_output'

export type ItemRole = 
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'developer'
  | 'critic'
  | 'discriminator'
  | 'unknown'

export type ItemStatus =
  | 'incomplete'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'searching'
  | 'generating'
  | 'calling'
  | 'streaming'
  | 'rate_limited'

export type ContentType =
  | 'text'
  | 'input_text'
  | 'output_text'
  | 'summary_text'
  | 'reasoning_text'
  | 'refusal'
  | 'input_image'
  | 'computer_screenshot'
  | 'input_file'

// Annotation types
export interface ConversationItemAnnotation {
  end_index?: number
  file_id?: string
  index?: number
  start_index?: number
  text?: string
  type?: string
  url?: string
}

// Content types
export interface BaseContent {
  type: ContentType
}

export interface TextContentData {
  text: string
  annotations?: ConversationItemAnnotation[]
}

export interface RefusalContent extends BaseContent {
  type: 'refusal'
  refusal: string
}

export interface ImageContent extends BaseContent {
  type: 'input_image'
  file_id?: string
  url?: string
  detail?: 'auto' | 'low' | 'high'
}

export interface ScreenshotContent extends BaseContent {
  type: 'computer_screenshot'
  file_id?: string
  url?: string
}

export interface FileContent extends BaseContent {
  type: 'input_file'
  file_id?: string
  file_url?: string
  file_data?: string
  filename?: string
}

// Consolidated content type (for API responses)
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
  text?: string | {
    value?: string
    text?: string
  }
  output_text?: {
    annotations?: ConversationItemAnnotation[]
    text?: string
  }
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
  tool_call_id?: string
  text_result?: string
}

// MCP Types
export interface McpTool {
  name: string
  input_schema: any
  description?: string
  annotations?: any
}

export interface SafetyCheck {
  type: string
  reason: string
}

export interface LocalShellCallAction {
  type: 'exec'
  command: string[]
  env: Record<string, string>
  timeout_ms?: number
  user?: string
  working_directory?: string
}

export interface ComputerAction {
  type: 'click' | 'type' | 'screenshot' | 'scroll' | 'drag'
  [key: string]: any
}

export interface ShellOutput {
  type: 'stdout' | 'stderr' | 'exit_code'
  value: string
}

export interface PatchOperation {
  type: string
  file_path: string
  patch_data: string
}

// Base Item Interface
export interface BaseConversationItem {
  id: string
  object: 'conversation.item'
  type: ItemType
  created_at: number | string
  status?: ItemStatus
  incomplete_at?: number
  incomplete_details?: {
    type?: string
    reason?: string
  }
  completed_at?: number
}

// Type-specific item interfaces
export interface MessageItem extends BaseConversationItem {
  type: 'message'
  role: ItemRole
  content?: ConversationItemContent[]
}

export interface McpListToolsItem extends BaseConversationItem {
  type: 'mcp_list_tools'
  server_label: string
  tools: McpTool[]
  error?: string
}

export interface McpApprovalRequestItem extends BaseConversationItem {
  type: 'mcp_approval_request'
  name: string
  arguments: string
  server_label: string
}

export interface McpApprovalResponseItem extends BaseConversationItem {
  type: 'mcp_approval_response'
  approval_request_id: string
  approve: boolean
  reason?: string
}

export interface McpCallItem extends BaseConversationItem {
  type: 'mcp_call'
  name: string
  arguments: string
  server_label: string
  approval_request_id?: string
  output?: string
  error?: string
  status: ItemStatus
}

export interface LocalShellCallItem extends BaseConversationItem {
  type: 'local_shell_call'
  call_id: string
  action: LocalShellCallAction
  status: ItemStatus
}

export interface LocalShellCallOutputItem extends BaseConversationItem {
  type: 'local_shell_call_output'
  call_id: string
  output: string
  status?: ItemStatus
}

export interface ComputerCallItem extends BaseConversationItem {
  type: 'computer_call'
  call_id: string
  action: ComputerAction
  status: ItemStatus
  pending_safety_checks?: SafetyCheck[]
}

export interface ComputerCallOutputItem extends BaseConversationItem {
  type: 'computer_call_output'
  call_id: string
  output: any
  status: ItemStatus
  acknowledged_safety_checks?: SafetyCheck[]
}

export interface ShellCallItem extends BaseConversationItem {
  type: 'shell_call'
  call_id: string
  commands: string[]
  max_output_length?: number
  status: ItemStatus
}

export interface ShellCallOutputItem extends BaseConversationItem {
  type: 'shell_call_output'
  call_id: string
  output: ShellOutput[]
  status: ItemStatus
}

export interface ApplyPatchCallItem extends BaseConversationItem {
  type: 'apply_patch_call'
  call_id: string
  operation: PatchOperation
  status: ItemStatus
}

export interface ApplyPatchCallOutputItem extends BaseConversationItem {
  type: 'apply_patch_call_output'
  call_id: string
  output: string
  status: ItemStatus
}

// Union type for all conversation items
export type ConversationItemVariant =
  | MessageItem
  | McpListToolsItem
  | McpApprovalRequestItem
  | McpApprovalResponseItem
  | McpCallItem
  | LocalShellCallItem
  | LocalShellCallOutputItem
  | ComputerCallItem
  | ComputerCallOutputItem
  | ShellCallItem
  | ShellCallOutputItem
  | ApplyPatchCallItem
  | ApplyPatchCallOutputItem

// Legacy ConversationItem interface for backward compatibility
export interface ConversationItem {
  content?: ConversationItemContent[]
  created_at: number | string
  id: string
  object: string
  metadata?: Record<string, unknown>
  role: string
  status?: string
  type?: string
  
  // OpenAI-compatible fields
  call_id?: string
  server_label?: string
  approval_request_id?: string
  arguments?: string
  output?: string
  error?: string
  action?: any
  tools?: McpTool[]
  pending_safety_checks?: SafetyCheck[]
  acknowledged_safety_checks?: SafetyCheck[]
  approve?: boolean
  reason?: string
  commands?: string[]
  max_output_length?: number
  shell_outputs?: ShellOutput[]
  operation?: any
}

export interface ListConversationItemsParams extends PaginationParams {
  conversation_id: string
}

export interface ListConversationItemsResponse extends PaginatedResponse<ConversationItem> {
  total?: number
}

// Project Management types
export interface Project {
  id: string
  object: 'project'
  name: string
  instruction?: string
  is_favorite: boolean
  is_archived: boolean
  archived_at?: number
  created_at: number
  updated_at: number
}

export interface CreateProjectRequest {
  name: string
  instruction?: string
}

export interface UpdateProjectRequest {
  name?: string
  instruction?: string
  is_favorite?: boolean
  is_archived?: boolean
}

export interface ListProjectsParams {
  limit?: number
  cursor?: string
}

export interface ListProjectsResponse {
  object: 'list'
  data: Project[]
  first_id?: string
  last_id?: string
  next_cursor?: string
  has_more: boolean
  total: number
}

export interface DeleteProjectResponse {
  id: string
  object: 'project'
  deleted: boolean
}

// Enhanced Conversation types with project support
export interface ConversationWithProject extends Conversation {
  project_id?: string
}

export interface ConversationResponseWithProject extends ConversationResponse {
  project_id?: string
}

export interface ListConversationsWithProjectParams extends ListConversationsParams {
  project_id?: string
}
