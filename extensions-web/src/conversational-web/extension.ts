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
import { getDefaultAssistant, ObjectParser } from './utils'

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
      thread.id = response.id
      thread.assistants = thread.assistants.map(getDefaultAssistant)
      console.log('!!!Created thread:', thread)
      return thread
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
    console.log('!!!Listing messages for thread:', threadId)
    return []
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
