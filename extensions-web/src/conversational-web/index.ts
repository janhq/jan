/**
 * Web Conversational Extension
 * Implements thread and message management using IndexedDB
 */

import { Thread, ThreadMessage, ConversationalExtension, ThreadAssistantInfo } from '@janhq/core'
import { getSharedDB } from '../shared/db'

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

  // Thread Management
  async listThreads(): Promise<Thread[]> {
    return this.getThreads()
  }
  
  async getThreads(): Promise<Thread[]> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads'], 'readonly')
      const store = transaction.objectStore('threads')
      const request = store.getAll()

      request.onsuccess = () => {
        const threads = request.result || []
        // Sort by updated desc (most recent first)
        threads.sort((a, b) => (b.updated || 0) - (a.updated || 0))
        resolve(threads)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  async createThread(thread: Thread): Promise<Thread> {
    await this.saveThread(thread)
    return thread
  }

  async modifyThread(thread: Thread): Promise<void> {
    await this.saveThread(thread)
  }

  async saveThread(thread: Thread): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads'], 'readwrite')
      const store = transaction.objectStore('threads')
      
      const threadToStore = {
        ...thread,
        created: thread.created || Date.now() / 1000,
        updated: Date.now() / 1000,
      }
      
      const request = store.put(threadToStore)

      request.onsuccess = () => {
        console.log('Thread saved:', thread.id)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to save thread:', request.error)
        reject(request.error)
      }
    })
  }

  async deleteThread(threadId: string): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads', 'messages'], 'readwrite')
      const threadsStore = transaction.objectStore('threads')
      const messagesStore = transaction.objectStore('messages')

      // Delete thread
      const deleteThreadRequest = threadsStore.delete(threadId)
      
      // Delete all messages in the thread
      const messageIndex = messagesStore.index('thread_id')
      const messagesRequest = messageIndex.openCursor(IDBKeyRange.only(threadId))
      
      messagesRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      transaction.oncomplete = () => {
        console.log('Thread and messages deleted:', threadId)
        resolve()
      }

      transaction.onerror = () => {
        console.error('Failed to delete thread:', transaction.error)
        reject(transaction.error)
      }
    })
  }

  // Message Management
  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    await this.addNewMessage(message)
    return message
  }

  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    return this.getAllMessages(threadId)
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite')
      const store = transaction.objectStore('messages')
      
      const messageToStore = {
        ...message,
        updated: Date.now() / 1000,
      }
      
      const request = store.put(messageToStore)

      request.onsuccess = () => {
        console.log('Message updated:', message.id)
        resolve(message)
      }

      request.onerror = () => {
        console.error('Failed to update message:', request.error)
        reject(request.error)
      }
    })
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite')
      const store = transaction.objectStore('messages')
      const request = store.delete(messageId)

      request.onsuccess = () => {
        console.log('Message deleted:', messageId)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to delete message:', request.error)
        reject(request.error)
      }
    })
  }

  async addNewMessage(message: ThreadMessage): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite')
      const store = transaction.objectStore('messages')
      
      const messageToStore = {
        ...message,
        created_at: message.created_at || Date.now() / 1000,
      }
      
      const request = store.add(messageToStore)

      request.onsuccess = () => {
        console.log('Message added:', message.id)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to add message:', request.error)
        reject(request.error)
      }
    })
  }

  async writeMessages(threadId: string, messages: ThreadMessage[]): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite')
      const store = transaction.objectStore('messages')

      // First, delete existing messages for this thread
      const index = store.index('thread_id')
      const deleteRequest = index.openCursor(IDBKeyRange.only(threadId))
      
      deleteRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          // After deleting old messages, add new ones
          const addPromises = messages.map(message => {
            return new Promise<void>((resolveAdd, rejectAdd) => {
              const messageToStore = {
                ...message,
                thread_id: threadId,
                created_at: message.created_at || Date.now() / 1000,
              }
              
              const addRequest = store.add(messageToStore)
              addRequest.onsuccess = () => resolveAdd()
              addRequest.onerror = () => rejectAdd(addRequest.error)
            })
          })

          Promise.all(addPromises)
            .then(() => {
              console.log(`${messages.length} messages written for thread:`, threadId)
              resolve()
            })
            .catch(reject)
        }
      }

      deleteRequest.onerror = () => {
        reject(deleteRequest.error)
      }
    })
  }

  async getAllMessages(threadId: string): Promise<ThreadMessage[]> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly')
      const store = transaction.objectStore('messages')
      const index = store.index('thread_id')
      const request = index.getAll(threadId)

      request.onsuccess = () => {
        const messages = request.result || []
        // Sort by created_at asc (chronological order)
        messages.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
        resolve(messages)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  // Thread Assistant Info (simplified - stored with thread)
  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    const info = await this.getThreadAssistantInfo(threadId)
    if (!info) {
      throw new Error(`Thread assistant info not found for thread ${threadId}`)
    }
    return info
  }

  async createThreadAssistant(threadId: string, assistant: ThreadAssistantInfo): Promise<ThreadAssistantInfo> {
    await this.saveThreadAssistantInfo(threadId, assistant)
    return assistant
  }

  async modifyThreadAssistant(threadId: string, assistant: ThreadAssistantInfo): Promise<ThreadAssistantInfo> {
    await this.saveThreadAssistantInfo(threadId, assistant)
    return assistant
  }

  async saveThreadAssistantInfo(threadId: string, assistantInfo: ThreadAssistantInfo): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads'], 'readwrite')
      const store = transaction.objectStore('threads')
      
      // Get existing thread and update with assistant info
      const getRequest = store.get(threadId)
      
      getRequest.onsuccess = () => {
        const thread = getRequest.result
        if (!thread) {
          reject(new Error(`Thread ${threadId} not found`))
          return
        }
        
        const updatedThread = {
          ...thread,
          assistantInfo,
          updated_at: Date.now() / 1000,
        }
        
        const putRequest = store.put(updatedThread)
        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => reject(putRequest.error)
      }
      
      getRequest.onerror = () => {
        reject(getRequest.error)
      }
    })
  }

  async getThreadAssistantInfo(threadId: string): Promise<ThreadAssistantInfo | undefined> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['threads'], 'readonly')
      const store = transaction.objectStore('threads')
      const request = store.get(threadId)

      request.onsuccess = () => {
        const thread = request.result
        resolve(thread?.assistantInfo)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }
}