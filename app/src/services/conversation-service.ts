import { fetchJsonWithAuth } from '@/lib/api-client'

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

  deleteConversation: async (conversationId: string): Promise<void> => {
    return fetchJsonWithAuth<void>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    )
  },

  getItems: async (
    conversationId: string
  ): Promise<ConversationItemsResponse> => {
    return fetchJsonWithAuth<ConversationItemsResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items?limit=${100}&order=asc`
    )
  },
}
