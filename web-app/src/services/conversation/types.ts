/**
 * Conversation Service Types
 */

/**
 * Provider interface for conversation operations.
 * Enables different sources (cloud API, local storage, etc.)
 */
export interface ConversationService {
  // Conversation CRUD
  getConversations(): Promise<ConversationsResponse>
  createConversation(payload: CreateConversationPayload): Promise<Conversation>
  getConversation(conversationId: string): Promise<Conversation>
  deleteConversation(conversationId: string): Promise<void>
  deleteAllConversations(): Promise<void>
  updateConversation(
    conversationId: string,
    payload: UpdateConversationPayload
  ): Promise<Conversation>

  // Items operations
  getItems(
    conversationId: string,
    branch?: string
  ): Promise<ConversationItemsResponse>
  createItems(
    conversationId: string,
    items: CreateItemRequest[]
  ): Promise<ConversationItemsResponse>

  // Branch operations
  getBranches(conversationId: string): Promise<ListBranchesResponse>
  createBranch(
    conversationId: string,
    request: CreateBranchRequest
  ): Promise<ConversationBranch>
  getBranch(
    conversationId: string,
    branchName: string
  ): Promise<ConversationBranch>
  deleteBranch(conversationId: string, branchName: string): Promise<void>
  activateBranch(
    conversationId: string,
    branchName: string
  ): Promise<ActivateBranchResponse>

  // Message actions
  editMessage(
    conversationId: string,
    itemId: string,
    content: string,
    regenerate?: boolean
  ): Promise<EditMessageResponse>
  regenerateMessage(
    conversationId: string,
    itemId: string,
    options?: RegenerateMessageRequest
  ): Promise<RegenerateMessageResponse>
  deleteMessage(
    conversationId: string,
    itemId: string
  ): Promise<DeleteItemResponse>
}
