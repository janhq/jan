import { fetchJsonWithAuth } from '@/lib/api-client'
import { QUERY_ORDER, QUERY_LIMIT } from '@/constants'

declare const JAN_API_BASE_URL: string

export const conversationService = {
  getConversations: async (): Promise<ConversationsResponse> => {
    return fetchJsonWithAuth<ConversationsResponse>(
      `${JAN_API_BASE_URL}v1/conversations`
    )
  },

  createConversation: async (
    payload: CreateConversationPayload
  ): Promise<Conversation> => {
    return fetchJsonWithAuth<Conversation>(
      `${JAN_API_BASE_URL}v1/conversations`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    )
  },

  getConversation: async (conversationId: string): Promise<Conversation> => {
    return fetchJsonWithAuth<Conversation>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}`
    )
  },

  deleteConversation: async (conversationId: string): Promise<void> => {
    return fetchJsonWithAuth<void>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    )
  },

  deleteAllConversations: async (): Promise<void> => {
    return fetchJsonWithAuth<void>(`${JAN_API_BASE_URL}v1/conversations`, {
      method: 'DELETE',
    })
  },

  updateConversation: async (
    conversationId: string,
    payload: UpdateConversationPayload
  ): Promise<Conversation> => {
    return fetchJsonWithAuth<Conversation>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    )
  },

  getItems: async (
    conversationId: string,
    branch?: string
  ): Promise<ConversationItemsResponse> => {
    const params = new URLSearchParams({ limit: String(QUERY_LIMIT.ITEMS), order: QUERY_ORDER.ASC })
    if (branch) {
      params.set('branch', branch)
    }
    return fetchJsonWithAuth<ConversationItemsResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items?${params}`
    )
  },

  createItems: async (
    conversationId: string,
    items: CreateItemRequest[]
  ): Promise<ConversationItemsResponse> => {
    return fetchJsonWithAuth<ConversationItemsResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items`,
      {
        method: 'POST',
        body: JSON.stringify(items),
      }
    )
  },

  // Branch operations
  getBranches: async (
    conversationId: string
  ): Promise<ListBranchesResponse> => {
    return fetchJsonWithAuth<ListBranchesResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches`
    )
  },

  createBranch: async (
    conversationId: string,
    request: CreateBranchRequest
  ): Promise<ConversationBranch> => {
    return fetchJsonWithAuth<ConversationBranch>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    )
  },

  getBranch: async (
    conversationId: string,
    branchName: string
  ): Promise<ConversationBranch> => {
    return fetchJsonWithAuth<ConversationBranch>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches/${branchName}`
    )
  },

  deleteBranch: async (
    conversationId: string,
    branchName: string
  ): Promise<void> => {
    return fetchJsonWithAuth<void>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches/${branchName}`,
      {
        method: 'DELETE',
      }
    )
  },

  activateBranch: async (
    conversationId: string,
    branchName: string
  ): Promise<ActivateBranchResponse> => {
    return fetchJsonWithAuth<ActivateBranchResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches/${branchName}/activate`,
      {
        method: 'POST',
      }
    )
  },

  // Message actions
  editMessage: async (
    conversationId: string,
    itemId: string,
    content: string,
    regenerate = true
  ): Promise<EditMessageResponse> => {
    return fetchJsonWithAuth<EditMessageResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items/${itemId}/edit`,
      {
        method: 'POST',
        body: JSON.stringify({ content, regenerate }),
      }
    )
  },

  regenerateMessage: async (
    conversationId: string,
    itemId: string,
    options?: RegenerateMessageRequest
  ): Promise<RegenerateMessageResponse> => {
    return fetchJsonWithAuth<RegenerateMessageResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items/${itemId}/regenerate`,
      {
        method: 'POST',
        body: options ? JSON.stringify(options) : undefined,
      }
    )
  },

  // Delete message and all subsequent messages in the branch
  deleteMessage: async (
    conversationId: string,
    itemId: string
  ): Promise<DeleteItemResponse> => {
    return fetchJsonWithAuth<DeleteItemResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items/${itemId}`,
      {
        method: 'DELETE',
      }
    )
  },
}
