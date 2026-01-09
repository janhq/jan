import { fetchJsonWithAuth } from '@/lib/api-client'
import { QUERY_ORDER, QUERY_LIMIT } from '@/constants'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { ThreadMessage, ChatCompletionRole } from '@janhq/core'
import { ContentType, MessageStatus } from '@janhq/core'

declare const JAN_API_BASE_URL: string

/**
 * Provider interface for conversation operations.
 * Enables different sources (cloud API, local storage, etc.)
 */
export interface ConversationProvider {
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

/**
 * Cloud-based conversation provider using Jan API.
 * Handles all conversation operations via authenticated API calls.
 */
class CloudConversationProvider implements ConversationProvider {
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

/**
 * Local conversation provider using ServiceHub threads and messages.
 * Maps between Thread/ThreadMessage model and Conversation API model.
 * This provider uses the local extension system for persistence.
 */
class LocalConversationProvider implements ConversationProvider {
  /**
   * Convert Thread to Conversation format
   */
  private threadToConversation(thread: Thread): Conversation {
    return {
      id: thread.id,
      object: 'conversation',
      title: thread.title,
      created_at: thread.updated ?? Date.now() / 1000, // Thread doesn't have created field
      updated_at: thread.updated ?? Date.now() / 1000,
      project_id: thread.metadata?.project?.id,
      active_branch: 'MAIN', // Local threads don't have branch support yet
      metadata: {
        is_favorite: thread.isFavorite ? 'true' : 'false',
        model_id: thread.model?.id ?? '',
        model_provider: thread.model?.provider ?? '',
      },
    }
  }

  /**
   * Parse text content to extract reasoning text within <think> tags
   * @param text - Raw text that may contain <think></think> tags
   * @returns Object with reasoning_text and regular text separated
   */
  private parseThinkingContent(text: string): {
    reasoning_text?: string
    text: string
  } {
    // Match <think>...</think> tags (non-greedy, case-insensitive, handles newlines)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/gi
    const matches = text.match(thinkRegex)

    if (!matches || matches.length === 0) {
      return { text }
    }

    // Extract all reasoning text from <think> tags
    const reasoningParts: string[] = []
    matches.forEach((match) => {
      const content = match.replace(/<\/?think>/gi, '').trim()
      if (content) {
        reasoningParts.push(content)
      }
    })

    // Remove <think> tags from the main text
    const cleanText = text.replace(thinkRegex, '').trim()

    return {
      reasoning_text: reasoningParts.length > 0 ? reasoningParts.join('\n\n') : undefined,
      text: cleanText,
    }
  }

  /**
   * Convert ThreadMessage to ConversationItem format
   */
  private messageToItem(message: ThreadMessage): ConversationItem {
    const content: ConversationItemContent[] = []

    // Handle different content types
    if (message.content && Array.isArray(message.content)) {
      message.content.forEach((c) => {
        if (c.type === ContentType.Text && c.text?.value) {
          const parsed = this.parseThinkingContent(c.text.value)

          // Create content item with reasoning_text if present
          const contentItem: ConversationItemContent = {
            type: 'text',
            text: parsed.text,
          }
          content.push(contentItem)

          if (parsed.reasoning_text) {
            const reasoningItem: ConversationItemContent = {
              type: 'reasoning',
              text: parsed.reasoning_text,
            }
            content.push(reasoningItem)
          }

        } else if (c.type === ContentType.Image && c.image_url?.url) {
          content.push({
            type: 'image',
            image: { url: c.image_url.url },
          })
        }
      })
    }

    return {
      id: message.id,
      object: 'conversation.item',
      role: message.role,
      content,
      created_at: message.created_at ?? Date.now() / 1000,
      branch: 'MAIN',
    }
  }

  /**
   * Convert ConversationItem content to ThreadMessage format
   */
  private itemToMessageContent(
    item: CreateItemRequest
  ): ThreadMessage['content'] {
    return item.content.map((c): ThreadMessage['content'][0] => {
      if (c.type === 'text' && c.text) {
        return {
          type: ContentType.Text,
          text: {
            value: typeof c.text === 'string' ? c.text : (c.text as any).text || '',
            annotations: [],
          },
        }
      } else if (c.type === 'image' && c.image?.url) {
        return {
          type: ContentType.Image,
          image_url: { url: c.image.url },
        }
      }
      // Default to text
      return {
        type: ContentType.Text,
        text: {
          value: '',
          annotations: [],
        },
      }
    })
  }

  async getConversations(): Promise<ConversationsResponse> {
    const threads = await getServiceHub().threads().fetchThreads()
    const conversations = threads.map((thread) =>
      this.threadToConversation(thread)
    )

    return {
      object: 'list',
      data: conversations,
      first_id: conversations[0]?.id ?? '',
      last_id: conversations[conversations.length - 1]?.id ?? '',
      has_more: false,
      total: conversations.length,
    }
  }

  async createConversation(
    payload: CreateConversationPayload
  ): Promise<Conversation> {
    const thread: Thread = {
      id: '', // Will be generated by createThread
      title: payload.title,
      model: {
        id: payload.metadata.model_id,
        provider: payload.metadata.model_provider,
      },
      updated: Date.now() / 1000,
      assistants: [],
      isFavorite: payload.metadata?.is_favorite === 'true',
      ...(payload.project_id && {
        metadata: {
          project: {
            id: payload.project_id,
            name: '', // Will be filled by createThread
            updated_at: Date.now() / 1000,
          },
        },
      }),
    }

    const createdThread = await getServiceHub()
      .threads()
      .createThread(thread)

    // Create initial messages if provided
    if (payload.items && payload.items.length > 0) {
      for (const item of payload.items) {
        const message: ThreadMessage = {
          id: '', // Will be generated
          thread_id: createdThread.id,
          role: item.role as ChatCompletionRole,
          content: this.itemToMessageContent(item),
          status: MessageStatus.Ready,
          created_at: Date.now() / 1000,
          completed_at: Date.now() / 1000,
          object: 'thread.message',
        }
        await getServiceHub().messages().createMessage(message)
      }
    }

    return this.threadToConversation(createdThread)
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    const threads = await getServiceHub().threads().fetchThreads()
    const thread = threads.find((t) => t.id === conversationId)

    if (!thread) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    return this.threadToConversation(thread)
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await getServiceHub().threads().deleteThread(conversationId)
  }

  async deleteAllConversations(): Promise<void> {
    const threads = await getServiceHub().threads().fetchThreads()
    await Promise.all(
      threads.map((thread) =>
        getServiceHub().threads().deleteThread(thread.id)
      )
    )
  }

  async updateConversation(
    conversationId: string,
    payload: UpdateConversationPayload
  ): Promise<Conversation> {
    const threads = await getServiceHub().threads().fetchThreads()
    const thread = threads.find((t) => t.id === conversationId)

    if (!thread) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    const updatedThread: Thread = {
      ...thread,
      ...(payload.title && { title: payload.title }),
      ...(payload.metadata?.model_id && {
        model: {
          id: payload.metadata.model_id,
          provider: payload.metadata.model_provider ?? thread.model?.provider ?? '',
        },
      }),
      ...(payload.metadata?.is_favorite !== undefined && {
        isFavorite: payload.metadata.is_favorite === 'true',
      }),
      updated: Date.now() / 1000,
    }

    await getServiceHub().threads().updateThread(updatedThread)
    return this.threadToConversation(updatedThread)
  }

  async getItems(
    conversationId: string,
    _branch?: string
  ): Promise<ConversationItemsResponse> {
    // Note: Local implementation doesn't support branches yet
    const messages = await getServiceHub().messages().fetchMessages(conversationId)
    const items = messages.map((msg) => this.messageToItem(msg))

    return {
      object: 'list',
      data: items,
      first_id: items[0]?.id ?? '',
      last_id: items[items.length - 1]?.id ?? '',
      has_more: false,
      total: items.length,
    }
  }

  async createItems(
    conversationId: string,
    items: CreateItemRequest[]
  ): Promise<ConversationItemsResponse> {
    const createdItems: ConversationItem[] = []

    for (const item of items) {
      const message: ThreadMessage = {
        id: '', // Will be generated
        thread_id: conversationId,
        role: item.role as ChatCompletionRole,
        content: this.itemToMessageContent(item),
        status: MessageStatus.Ready,
        created_at: Date.now() / 1000,
        completed_at: Date.now() / 1000,
        object: 'thread.message',
      }

      const createdMessage = await getServiceHub().messages().createMessage(message)
      createdItems.push(this.messageToItem(createdMessage))
    }

    return {
      object: 'list',
      data: createdItems,
      first_id: createdItems[0]?.id ?? '',
      last_id: createdItems[createdItems.length - 1]?.id ?? '',
      has_more: false,
      total: createdItems.length,
    }
  }

  // Branch operations - Not supported in local mode yet
  async getBranches(_conversationId: string): Promise<ListBranchesResponse> {
    return {
      object: 'list',
      data: [
        {
          name: 'MAIN',
          item_count: 0,
          created_at: Date.now() / 1000,
          updated_at: Date.now() / 1000,
          is_active: true,
        },
      ],
      active_branch: 'MAIN',
    }
  }

  async createBranch(
    _conversationId: string,
    _request: CreateBranchRequest
  ): Promise<ConversationBranch> {
    throw new Error('Branch operations not supported in local mode')
  }

  async getBranch(
    _conversationId: string,
    branchName: string
  ): Promise<ConversationBranch> {
    if (branchName === 'MAIN') {
      return {
        name: 'MAIN',
        item_count: 0,
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
        is_active: true,
      }
    }
    throw new Error('Branch operations not supported in local mode')
  }

  async deleteBranch(_conversationId: string, _branchName: string): Promise<void> {
    throw new Error('Branch operations not supported in local mode')
  }

  async activateBranch(
    _conversationId: string,
    _branchName: string
  ): Promise<ActivateBranchResponse> {
    throw new Error('Branch operations not supported in local mode')
  }

  // Message actions - Limited support in local mode
  async editMessage(
    conversationId: string,
    itemId: string,
    content: string,
    _regenerate = true
  ): Promise<EditMessageResponse> {
    const messages = await getServiceHub().messages().fetchMessages(conversationId)
    const message = messages.find((m) => m.id === itemId)

    if (!message) {
      throw new Error(`Message ${itemId} not found`)
    }

    // Update message content
    const updatedMessage: ThreadMessage = {
      ...message,
      content: [
        {
          type: ContentType.Text,
          text: {
            value: content,
            annotations: [],
          },
        },
      ],
      completed_at: Date.now() / 1000,
    }

    await getServiceHub().messages().modifyMessage(updatedMessage)

    return {
      branch: 'MAIN',
      old_main_backup: 'MAIN',
      branch_created: false,
      user_item: this.messageToItem(updatedMessage),
    }
  }

  /**
   * Regenerate an assistant message in local mode.
   *
   * This implementation:
   * 1. Finds the assistant message to regenerate
   * 2. Deletes it and all subsequent messages
   * 3. Returns the user message ID that triggered the response
   *
   * The caller is responsible for re-sending the user message to generate a new response.
   *
   * Note: RegenerateMessageRequest options (model, temperature, max_tokens) are not
   * supported in local mode as the model config is managed at the thread level.
   */
  async regenerateMessage(
    conversationId: string,
    itemId: string,
    _options?: RegenerateMessageRequest
  ): Promise<RegenerateMessageResponse> {
    const messages = await getServiceHub().messages().fetchMessages(conversationId)
    const messageIndex = messages.findIndex((m) => m.id === itemId)

    if (messageIndex === -1) {
      throw new Error(`Message ${itemId} not found`)
    }

    const messageToRegenerate = messages[messageIndex]

    // Can only regenerate assistant messages
    if (messageToRegenerate.role !== 'assistant') {
      throw new Error('Can only regenerate assistant messages')
    }

    // Find the corresponding user message (should be before this assistant message)
    let userMessageId = ''
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageId = messages[i].id
        break
      }
    }

    if (!userMessageId) {
      throw new Error('No user message found to regenerate from')
    }

    // Delete the assistant message and all messages after it
    for (let i = messageIndex; i < messages.length; i++) {
      await getServiceHub().messages().deleteMessage(conversationId, messages[i].id)
    }

    return {
      branch: 'MAIN',
      old_main_backup: 'MAIN',
      branch_created: false,
      user_item_id: userMessageId,
    }
  }

  async deleteMessage(
    conversationId: string,
    itemId: string
  ): Promise<DeleteItemResponse> {
    await getServiceHub().messages().deleteMessage(conversationId, itemId)

    return {
      branch: 'MAIN',
      old_main_backup: 'MAIN',
      branch_created: false,
      deleted: true,
    }
  }
}

/**
 * Main conversation service factory.
 * Creates a conversation service instance bound to a specific provider.
 *
 * @param source - The data source to use ('cloud' for API, 'local' for ServiceHub)
 * @returns A conversation service instance with all operations bound to the selected provider
 *
 * @example
 * // Cloud service (API-based)
 * const cloudService = conversationService('cloud')
 * const conversations = await cloudService.getConversations()
 *
 * @example
 * // Local service (ServiceHub-based)
 * const localService = conversationService('local')
 * await localService.createConversation(payload)
 */
export const conversationService = (
  source: 'cloud' | 'local' = 'cloud'
): ConversationProvider => {
  if (source === 'cloud') {
    return new CloudConversationProvider()
  }
  return new LocalConversationProvider()
}

/**
 * @deprecated Use conversationService(source) instead
 * Legacy factory function for backward compatibility
 */
export const conversationProviderFactory = conversationService
