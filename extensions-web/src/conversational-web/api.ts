/**
 * Conversation API wrapper using JanAuthProvider
 */

import { getSharedAuthService, JanAuthService } from '../shared/auth'
import { CONVERSATION_API_ROUTES } from './const'
import {
  Conversation,
  ConversationResponse,
  ListConversationsParams,
  ListConversationsResponse,
  PaginationParams,
  PaginatedResponse,
  ConversationItem,
  ListConversationItemsParams,
  ListConversationItemsResponse
} from './types'

declare const JAN_BASE_URL: string

export class RemoteApi {
  private authService: JanAuthService

  constructor() {
    this.authService = getSharedAuthService()
  }

  async createConversation(
    data: Conversation
  ): Promise<ConversationResponse> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATIONS}`

    return this.authService.makeAuthenticatedRequest<ConversationResponse>(
      url,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    )
  }

  async updateConversation(
    conversationId: string,
    data: Conversation
  ): Promise<ConversationResponse> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATION_BY_ID(conversationId)}`

    return this.authService.makeAuthenticatedRequest<ConversationResponse>(
      url,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    )
  }

  async listConversations(
    params?: ListConversationsParams
  ): Promise<ListConversationsResponse> {
    const queryParams = new URLSearchParams()

    if (params?.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params?.after) {
      queryParams.append('after', params.after)
    }
    if (params?.order) {
      queryParams.append('order', params.order)
    }

    const queryString = queryParams.toString()
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATIONS}${queryString ? `?${queryString}` : ''}`

    return this.authService.makeAuthenticatedRequest<ListConversationsResponse>(
      url,
      {
        method: 'GET',
      }
    )
  }

  /**
   * Generic method to fetch all pages of paginated data
   */
  async fetchAllPaginated<T>(
    fetchFn: (params: PaginationParams) => Promise<PaginatedResponse<T>>,
    initialParams?: Partial<PaginationParams>
  ): Promise<T[]> {
    const allItems: T[] = []
    let after: string | undefined = undefined
    let hasMore = true
    const limit = initialParams?.limit || 100

    while (hasMore) {
      const response = await fetchFn({
        limit,
        after,
        ...initialParams,
      })

      allItems.push(...response.data)
      hasMore = response.has_more
      after = response.last_id
    }

    return allItems
  }

  async getAllConversations(): Promise<ConversationResponse[]> {
    return this.fetchAllPaginated<ConversationResponse>(
      (params) => this.listConversations(params)
    )
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATION_BY_ID(conversationId)}`

    await this.authService.makeAuthenticatedRequest(
      url,
      {
        method: 'DELETE',
      }
    )
  }

  async listConversationItems(
    conversationId: string,
    params?: Omit<ListConversationItemsParams, 'conversation_id'>
  ): Promise<ListConversationItemsResponse> {
    const queryParams = new URLSearchParams()

    if (params?.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params?.after) {
      queryParams.append('after', params.after)
    }
    if (params?.order) {
      queryParams.append('order', params.order)
    }

    const queryString = queryParams.toString()
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATION_ITEMS(conversationId)}${queryString ? `?${queryString}` : ''}`

    return this.authService.makeAuthenticatedRequest<ListConversationItemsResponse>(
      url,
      {
        method: 'GET',
      }
    )
  }

  async getAllConversationItems(conversationId: string): Promise<ConversationItem[]> {
    return this.fetchAllPaginated<ConversationItem>(
      (params) => this.listConversationItems(conversationId, params),
      { limit: 100, order: 'asc' }
    )
  }
}
