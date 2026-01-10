/**
 * Cloud Conversation Service - API-based implementation
 */

import { fetchJsonWithAuth } from '@/lib/api-client'
import { QUERY_ORDER, QUERY_LIMIT } from '@/constants'
import type { ConversationService } from './types'

declare const JAN_API_BASE_URL: string

/**
 * Cloud-based conversation provider using Jan API.
 * Handles all conversation operations via authenticated API calls.
 */
export class CloudConversationService implements ConversationService {
  async getConversations(): Promise<ConversationsResponse> {
    return fetchJsonWithAuth<ConversationsResponse>(
      `${JAN_API_BASE_URL}v1/conversations`
    )
  }

  async createConversation(
    payload: CreateConversationPayload
  ): Promise<Conversation> {
    return fetchJsonWithAuth<Conversation>(
      `${JAN_API_BASE_URL}v1/conversations`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    )
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    return fetchJsonWithAuth<Conversation>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}`
    )
  }

  async deleteConversation(conversationId: string): Promise<void> {
    return fetchJsonWithAuth<void>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    )
  }

  async deleteAllConversations(): Promise<void> {
    return fetchJsonWithAuth<void>(`${JAN_API_BASE_URL}v1/conversations`, {
      method: 'DELETE',
    })
  }

  async updateConversation(
    conversationId: string,
    payload: UpdateConversationPayload
  ): Promise<Conversation> {
    return fetchJsonWithAuth<Conversation>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    )
  }

  async getItems(
    conversationId: string,
    branch?: string
  ): Promise<ConversationItemsResponse> {
    const params = new URLSearchParams({
      limit: String(QUERY_LIMIT.ITEMS),
      order: QUERY_ORDER.ASC,
    })
    if (branch) {
      params.set('branch', branch)
    }
    return fetchJsonWithAuth<ConversationItemsResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items?${params}`
    )
  }

  async createItems(
    conversationId: string,
    items: CreateItemRequest[]
  ): Promise<ConversationItemsResponse> {
    return fetchJsonWithAuth<ConversationItemsResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ items }),
      }
    )
  }

  async getBranches(conversationId: string): Promise<ListBranchesResponse> {
    return fetchJsonWithAuth<ListBranchesResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches`
    )
  }

  async createBranch(
    conversationId: string,
    request: CreateBranchRequest
  ): Promise<ConversationBranch> {
    return fetchJsonWithAuth<ConversationBranch>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    )
  }

  async getBranch(
    conversationId: string,
    branchName: string
  ): Promise<ConversationBranch> {
    return fetchJsonWithAuth<ConversationBranch>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches/${branchName}`
    )
  }

  async deleteBranch(conversationId: string, branchName: string): Promise<void> {
    return fetchJsonWithAuth<void>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches/${branchName}`,
      {
        method: 'DELETE',
      }
    )
  }

  async activateBranch(
    conversationId: string,
    branchName: string
  ): Promise<ActivateBranchResponse> {
    return fetchJsonWithAuth<ActivateBranchResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/branches/${branchName}/activate`,
      {
        method: 'POST',
      }
    )
  }

  async editMessage(
    conversationId: string,
    itemId: string,
    content: string,
    regenerate = true
  ): Promise<EditMessageResponse> {
    return fetchJsonWithAuth<EditMessageResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items/${itemId}/edit`,
      {
        method: 'POST',
        body: JSON.stringify({ content, regenerate }),
      }
    )
  }

  async regenerateMessage(
    conversationId: string,
    itemId: string,
    options?: RegenerateMessageRequest
  ): Promise<RegenerateMessageResponse> {
    return fetchJsonWithAuth<RegenerateMessageResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items/${itemId}/regenerate`,
      {
        method: 'POST',
        body: options ? JSON.stringify(options) : undefined,
      }
    )
  }

  async deleteMessage(
    conversationId: string,
    itemId: string
  ): Promise<DeleteItemResponse> {
    return fetchJsonWithAuth<DeleteItemResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/items/${itemId}`,
      {
        method: 'DELETE',
      }
    )
  }
}
