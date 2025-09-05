/**
 * Web Assistant Extension
 * Implements assistant management using IndexedDB
 */

import { Assistant, AssistantExtension } from '@janhq/core'
import { getSharedDB } from '../shared/db'

export default class AssistantExtensionWeb extends AssistantExtension {
  private db: IDBDatabase | null = null

  private defaultAssistant: Assistant = {
    avatar: '👋',
    thread_location: undefined,
    id: 'jan',
    object: 'assistant',
    created_at: Date.now() / 1000,
    name: 'Jan',
    description:
      'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user\'s behalf.',
    model: '*',
    instructions:
      'You are a helpful AI assistant. Your primary goal is to assist users with their questions and tasks to the best of your abilities.\n\n' +
      'When responding:\n' +
      '- Answer directly from your knowledge when you can\n' +
      '- Be concise, clear, and helpful\n' +
      '- Admit when you\'re unsure rather than making things up\n\n' +
      'If tools are available to you:\n' +
      '- Only use tools when they add real value to your response\n' +
      '- Use tools when the user explicitly asks (e.g., "search for...", "calculate...", "run this code")\n' +
      '- Use tools for information you don\'t know or that needs verification\n' +
      '- Never use tools just because they\'re available\n\n' +
      'When using tools:\n' +
      '- Use one tool at a time and wait for results\n' +
      '- Use actual values as arguments, not variable names\n' +
      '- Learn from each result before deciding next steps\n' +
      '- Avoid repeating the same tool call with identical parameters\n\n' +
      'Remember: Most questions can be answered without tools. Think first whether you need them.\n\n' +
      'Current date: {{current_date}}',
    tools: [
      {
        type: 'retrieval',
        enabled: false,
        useTimeWeightedRetriever: false,
        settings: {
          top_k: 2,
          chunk_size: 1024,
          chunk_overlap: 64,
          retrieval_template: `Use the following pieces of context to answer the question at the end.
{context}
Question: {question}
Helpful Answer:`,
        },
      },
    ],
    file_ids: [],
    metadata: undefined,
  }

  async onLoad() {
    console.log('Loading Web Assistant Extension')
    this.db = await getSharedDB()
    
    // Create default assistant if none exist
    const assistants = await this.getAssistants()
    if (assistants.length === 0) {
      await this.createAssistant(this.defaultAssistant)
    }
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

  async getAssistants(): Promise<Assistant[]> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assistants'], 'readonly')
      const store = transaction.objectStore('assistants')
      const request = store.getAll()

      request.onsuccess = () => {
        resolve(request.result || [])
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assistants'], 'readwrite')
      const store = transaction.objectStore('assistants')
      
      const assistantToStore = {
        ...assistant,
        created_at: assistant.created_at || Date.now() / 1000,
      }
      
      const request = store.add(assistantToStore)

      request.onsuccess = () => {
        console.log('Assistant created:', assistant.id)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to create assistant:', request.error)
        reject(request.error)
      }
    })
  }

  async updateAssistant(id: string, assistant: Partial<Assistant>): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assistants'], 'readwrite')
      const store = transaction.objectStore('assistants')
      
      // First get the existing assistant
      const getRequest = store.get(id)
      
      getRequest.onsuccess = () => {
        const existingAssistant = getRequest.result
        if (!existingAssistant) {
          reject(new Error(`Assistant with id ${id} not found`))
          return
        }
        
        const updatedAssistant = {
          ...existingAssistant,
          ...assistant,
          id, // Ensure ID doesn't change
        }
        
        const putRequest = store.put(updatedAssistant)
        
        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => reject(putRequest.error)
      }
      
      getRequest.onerror = () => {
        reject(getRequest.error)
      }
    })
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assistants'], 'readwrite')
      const store = transaction.objectStore('assistants')
      const request = store.delete(assistant.id)

      request.onsuccess = () => {
        console.log('Assistant deleted:', assistant.id)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to delete assistant:', request.error)
        reject(request.error)
      }
    })
  }

  async getAssistant(id: string): Promise<Assistant | null> {
    this.ensureDB()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assistants'], 'readonly')
      const store = transaction.objectStore('assistants')
      const request = store.get(id)

      request.onsuccess = () => {
        resolve(request.result || null)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }
}