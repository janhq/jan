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
  ListConversationItemsResponse,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ListProjectsParams,
  ListProjectsResponse,
  DeleteProjectResponse,
  ConversationWithProject,
  ConversationResponseWithProject,
  ListConversationsWithProjectParams,
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

    console.log('[RemoteApi] listConversations: GET', url, 'with params:', params)
    const response = await this.authService.makeAuthenticatedRequest<ListConversationsResponse>(
      url,
      {
        method: 'GET',
      }
    )
    console.log('[RemoteApi] listConversations: Response:', { count: response.data.length, has_more: response.has_more })
    return response
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
    console.log('[RemoteApi] getAllConversations: Fetching all conversations from', `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATIONS}`)
    const conversations = await this.fetchAllPaginated<ConversationResponse>(
      (params) => this.listConversations(params)
    )
    console.log('[RemoteApi] getAllConversations: Retrieved', conversations.length, 'conversations')
    return conversations
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

  async createConversationItem(
    conversationId: string,
    data: {
      role: 'user' | 'assistant'
      content: string
      status?: string
      metadata?: Record<string, unknown>
    }
  ): Promise<ConversationItem> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATION_ITEMS(conversationId)}`

    return this.authService.makeAuthenticatedRequest<ConversationItem>(
      url,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    )
  }

  // Project Management methods
  async createProject(data: CreateProjectRequest): Promise<Project> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.PROJECTS}`

    return this.authService.makeAuthenticatedRequest<Project>(
      url,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    )
  }

  async getProject(projectId: string): Promise<Project> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.PROJECT_BY_ID(projectId)}`

    return this.authService.makeAuthenticatedRequest<Project>(
      url,
      {
        method: 'GET',
      }
    )
  }

  async updateProject(
    projectId: string,
    data: UpdateProjectRequest
  ): Promise<Project> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.PROJECT_BY_ID(projectId)}`

    return this.authService.makeAuthenticatedRequest<Project>(
      url,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }

  async listProjects(params?: ListProjectsParams): Promise<ListProjectsResponse> {
    const queryParams = new URLSearchParams()

    if (params?.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params?.cursor) {
      queryParams.append('cursor', params.cursor)
    }

    const queryString = queryParams.toString()
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.PROJECTS}${queryString ? `?${queryString}` : ''}`

    return this.authService.makeAuthenticatedRequest<ListProjectsResponse>(
      url,
      {
        method: 'GET',
      }
    )
  }

  async deleteProject(projectId: string): Promise<DeleteProjectResponse> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.PROJECT_BY_ID(projectId)}`

    return this.authService.makeAuthenticatedRequest<DeleteProjectResponse>(
      url,
      {
        method: 'DELETE',
      }
    )
  }

  // Enhanced conversation methods with project support
  async createConversationInProject(
    data: ConversationWithProject
  ): Promise<ConversationResponseWithProject> {
    const url = `${JAN_BASE_URL}${CONVERSATION_API_ROUTES.CONVERSATIONS}`

    return this.authService.makeAuthenticatedRequest<ConversationResponseWithProject>(
      url,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    )
  }

  async listConversationsByProject(
    params?: ListConversationsWithProjectParams
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
    if (params?.project_id) {
      queryParams.append('project_id', params.project_id)
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
}
