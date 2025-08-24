/**
 * Web Conversational Extension
 * Implements thread and message management using IndexedDB
 */

import {
  ConversationalExtension,
  Thread,
  ThreadAssistantInfo,
  ThreadMessage,
} from '@janhq/core'
import { getSharedDB } from '../../lib/platform/adapters/web/db'

export default class ConversationalExtensionWeb extends ConversationalExtension {
  private db: IDBDatabase | null = null

  async onLoad() {
    console.log('Loading Web Conversational Extension')
    this.db = await getSharedDB()
  }

  onUnload() {
    // Don't close shared DB, other extensions might be using it
    this.db = null
  }

  private ensureDB(): void {
    if (!this.db) {
      throw new Error('Database not initialized. Call onLoad() first.')
    }
  }

  // Thread operations
  async listThreads(): Promise<Thread[]> {
    this.ensureDB()
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads'], 'readonly')
      const store = transaction.objectStore('threads')
      const request = store.getAll()

      request.onsuccess = () => {
        resolve(request.result || [])
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  async createThread(thread: Partial<Thread>): Promise<Thread> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads'], 'readwrite')
      const store = transaction.objectStore('threads')
      
      const threadToStore = {
        ...thread,
        id: thread.id || `thread_${Date.now()}`,
        created: thread.created || Date.now(),
        updated: thread.updated || Date.now(),
      }
      
      const request = store.add(threadToStore)

      request.onsuccess = () => resolve(threadToStore as Thread)
      request.onerror = () => reject(request.error)
    })
  }

  async modifyThread(thread: Thread): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads'], 'readwrite')
      const store = transaction.objectStore('threads')
      
      const threadToStore = {
        ...thread,
        updated: Date.now(),
      }
      
      const request = store.put(threadToStore)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteThread(threadId: string): Promise<void> {
    this.ensureDB()

    return this.executeWithRetry(async () => {
      return new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction(['threads', 'messages', 'threadAssistants'], 'readwrite')
        
        // Delete thread
        const threadStore = transaction.objectStore('threads')
        threadStore.delete(threadId)
        
        // Delete associated messages
        const messageStore = transaction.objectStore('messages')
        const messageIndex = messageStore.index('thread_id')
        const messageRequest = messageIndex.openCursor(IDBKeyRange.only(threadId))
        
        messageRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result
          if (cursor) {
            cursor.delete()
            cursor.continue()
          }
        }
        
        // Delete thread assistant
        const assistantStore = transaction.objectStore('threadAssistants')
        assistantStore.delete(threadId)

        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
    })
  }

  // Helper method for retry logic on IndexedDB operations
  private async executeWithRetry<T>(operation: () => Promise<T>, retries: number = 3): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error as Error
        console.warn(`IndexedDB operation failed (attempt ${attempt + 1}/${retries}):`, error)
        
        // Wait before retry (exponential backoff)
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100))
        }
      }
    }
    
    throw lastError || new Error('IndexedDB operation failed after retries')
  }

  // Message operations
  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly')
      const store = transaction.objectStore('messages')
      const index = store.index('thread_id')
      const request = index.getAll(threadId)

      request.onsuccess = () => {
        // Sort by created_at
        const messages = (request.result || []).sort((a, b) => a.created_at - b.created_at)
        resolve(messages)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  async createMessage(message: Partial<ThreadMessage>): Promise<ThreadMessage> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite')
      const store = transaction.objectStore('messages')
      
      const messageToStore = {
        ...message,
        id: message.id || `message_${Date.now()}`,
        created_at: message.created_at || Date.now(),
      }
      
      const request = store.add(messageToStore)

      request.onsuccess = () => resolve(messageToStore as ThreadMessage)
      request.onerror = () => reject(request.error)
    })
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite')
      const store = transaction.objectStore('messages')
      const request = store.put(message)

      request.onsuccess = () => resolve(message)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite')
      const store = transaction.objectStore('messages')
      const request = store.delete(messageId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Thread assistant operations
  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threadAssistants'], 'readonly')
      const store = transaction.objectStore('threadAssistants')
      const request = store.get(threadId)

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  async createThreadAssistant(threadId: string, assistant: ThreadAssistantInfo): Promise<ThreadAssistantInfo> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threadAssistants'], 'readwrite')
      const store = transaction.objectStore('threadAssistants')
      
      const assistantToStore = {
        thread_id: threadId,
        ...assistant,
      }
      
      const request = store.put(assistantToStore)

      request.onsuccess = () => resolve(assistant)
      request.onerror = () => reject(request.error)
    })
  }

  async modifyThreadAssistant(threadId: string, assistant: ThreadAssistantInfo): Promise<ThreadAssistantInfo> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threadAssistants'], 'readwrite')
      const store = transaction.objectStore('threadAssistants')
      
      const assistantToStore = {
        thread_id: threadId,
        ...assistant,
      }
      
      const request = store.put(assistantToStore)

      request.onsuccess = () => resolve(assistant)
      request.onerror = () => reject(request.error)
    })
  }
}