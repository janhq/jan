/**
 * Web Conversational Extension
 * Implements thread and message management using IndexedDB
 */

import {
  Thread,
  ThreadMessage,
  ConversationalExtension,
  ThreadAssistantInfo,
} from '@janhq/core'
import { RemoteApi } from './api'
import { getDefaultAssistant, ObjectParser, combineConversationItemsToMessages } from './utils'
import { ApiError } from '../shared/types/errors'

const CONVERSATION_NOT_FOUND_EVENT = 'conversation-not-found'

export default class ConversationalExtensionWeb extends ConversationalExtension {
  private remoteApi: RemoteApi | undefined

  async onLoad() {
    console.log('Loading Web Conversational Extension')
    this.remoteApi = new RemoteApi()
  }

  onUnload() {}

  // Thread Management
  async listThreads(): Promise<Thread[]> {
    try {
      if (!this.remoteApi) {
        throw new Error('RemoteApi not initialized')
      }
      const conversations = await this.remoteApi.getAllConversations()
      console.log('!!!Listed threads:', conversations.map(ObjectParser.conversationToThread))
      return conversations.map(ObjectParser.conversationToThread)
    } catch (error) {
      console.error('Failed to list threads:', error)
      return []
    }
  }

  async createThread(thread: Thread): Promise<Thread> {
    try {
      if (!this.remoteApi) {
        throw new Error('RemoteApi not initialized')
      }
      const response = await this.remoteApi.createConversation(
        ObjectParser.threadToConversation(thread)
      )
      // Create a new thread object with the server's ID
      const createdThread = {
        ...thread,
        id: response.id,
        assistants: thread.assistants.map(getDefaultAssistant)
      }
      console.log('!!!Created thread:', createdThread)
      return createdThread
    } catch (error) {
      console.error('Failed to create thread:', error)
      throw error
    }
  }

  async modifyThread(thread: Thread): Promise<void> {
    try {
      if (!this.remoteApi) {
        throw new Error('RemoteApi not initialized')
      }
      await this.remoteApi.updateConversation(
        thread.id,
        ObjectParser.threadToConversation(thread)
      )
      console.log('!!!Modified thread:', thread)
    } catch (error) {
      console.error('Failed to modify thread:', error)
      throw error
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    try {
      if (!this.remoteApi) {
        throw new Error('RemoteApi not initialized')
      }
      await this.remoteApi.deleteConversation(threadId)
      console.log('!!!Deleted thread:', threadId)
    } catch (error) {
      console.error('Failed to delete thread:', error)
      throw error
    }
  }

  // Message Management
  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    console.log('!!!Created message:', message)
    return message
  }

  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    try {
      if (!this.remoteApi) {
        throw new Error('RemoteApi not initialized')
      }
      console.log('!!!Listing messages for thread:', threadId)

      // Fetch all conversation items from the API
      const items = await this.remoteApi.getAllConversationItems(threadId)

      // Convert and combine conversation items to thread messages
      const messages = combineConversationItemsToMessages(items, threadId)

      console.log('!!!Fetched messages:', messages)
      return messages
    } catch (error) {
      console.error('Failed to list messages:', error)
      // Check if it's a 404 error (conversation not found)
      if (error instanceof ApiError && error.isNotFound()) {
        // Trigger a navigation event to redirect to home
        // We'll use a custom event that the web app can listen to
        window.dispatchEvent(new CustomEvent(CONVERSATION_NOT_FOUND_EVENT, {
          detail: { threadId, error: error.message }
        }))
      }

      return []
    }
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    console.log('!!!Modified message:', message)
    return message
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    console.log('!!!Deleted message:', threadId, messageId)
  }

  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    console.log('!!!Getting assistant for thread:', threadId)
    return { id: 'jan', name: 'Jan', model: { id: 'jan-v1-4b' } }
  }

  async createThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    console.log('!!!Creating assistant for thread:', threadId, assistant)
    return assistant
  }

  async modifyThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    console.log('!!!Modifying assistant for thread:', threadId, assistant)
    return assistant
  }

  async getThreadAssistantInfo(
    threadId: string
  ): Promise<ThreadAssistantInfo | undefined> {
    console.log('!!!Getting assistant info for thread:', threadId)
    return { id: 'jan', name: 'Jan', model: { id: 'jan-v1-4b' } }
  }
}
