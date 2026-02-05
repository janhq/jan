import { describe, it, test, expect, beforeEach } from 'vitest'
import { ConversationalExtension } from './conversational'
import { ExtensionTypeEnum } from '../extension'
import { Thread, ThreadAssistantInfo, ThreadMessage } from '../../types'

// Mock implementation of ConversationalExtension
class MockConversationalExtension extends ConversationalExtension {
  private threads: Thread[] = []
  private messages: { [threadId: string]: ThreadMessage[] } = {}
  private assistants: { [threadId: string]: ThreadAssistantInfo } = {}

  constructor() {
    super('http://mock-url.com', 'mock-extension', 'Mock Extension', true, 'A mock extension', '1.0.0')
  }

  onLoad(): void {
    // Mock implementation
  }

  onUnload(): void {
    // Mock implementation
  }

  async listThreads(): Promise<Thread[]> {
    return this.threads
  }

  async createThread(thread: Partial<Thread>): Promise<Thread> {
    const newThread: Thread = {
      id: thread.id || `thread-${Date.now()}`,
      name: thread.name || 'New Thread',
      createdAt: thread.createdAt || new Date().toISOString(),
      updatedAt: thread.updatedAt || new Date().toISOString(),
    }
    this.threads.push(newThread)
    this.messages[newThread.id] = []
    return newThread
  }

  async modifyThread(thread: Thread): Promise<void> {
    const index = this.threads.findIndex(t => t.id === thread.id)
    if (index !== -1) {
      this.threads[index] = thread
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads = this.threads.filter(t => t.id !== threadId)
    delete this.messages[threadId]
    delete this.assistants[threadId]
  }

  async createMessage(message: Partial<ThreadMessage>): Promise<ThreadMessage> {
    if (!message.threadId) throw new Error('Thread ID is required')
    
    const newMessage: ThreadMessage = {
      id: message.id || `message-${Date.now()}`,
      threadId: message.threadId,
      content: message.content || '',
      role: message.role || 'user',
      createdAt: message.createdAt || new Date().toISOString(),
    }
    
    if (!this.messages[message.threadId]) {
      this.messages[message.threadId] = []
    }
    
    this.messages[message.threadId].push(newMessage)
    return newMessage
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    if (this.messages[threadId]) {
      this.messages[threadId] = this.messages[threadId].filter(m => m.id !== messageId)
    }
  }

  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    return this.messages[threadId] || []
  }

  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    return this.assistants[threadId] || { modelId: '', threadId }
  }

  async createThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    this.assistants[threadId] = assistant
    return assistant
  }

  async modifyThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    this.assistants[threadId] = assistant
    return assistant
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    if (!this.messages[message.threadId]) return message
    
    const index = this.messages[message.threadId].findIndex(m => m.id === message.id)
    if (index !== -1) {
      this.messages[message.threadId][index] = message
    }
    
    return message
  }
}

describe('ConversationalExtension', () => {
  let extension: MockConversationalExtension

  beforeEach(() => {
    extension = new MockConversationalExtension()
  })

  test('should return the correct extension type', () => {
    expect(extension.type()).toBe(ExtensionTypeEnum.Conversational)
  })

  test('should create and list threads', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    expect(thread.name).toBe('Test Thread')
    
    const threads = await extension.listThreads()
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe(thread.id)
  })

  test('should modify thread', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    const modifiedThread = { ...thread, name: 'Modified Thread' }
    
    await extension.modifyThread(modifiedThread)
    
    const threads = await extension.listThreads()
    expect(threads[0].name).toBe('Modified Thread')
  })

  test('should delete thread', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    
    await extension.deleteThread(thread.id)
    
    const threads = await extension.listThreads()
    expect(threads).toHaveLength(0)
  })

  test('should create and list messages', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    
    const message = await extension.createMessage({ 
      threadId: thread.id,
      content: 'Test message',
      role: 'user'
    })
    
    expect(message.content).toBe('Test message')
    
    const messages = await extension.listMessages(thread.id)
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe(message.id)
  })

  test('should modify message', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    
    const message = await extension.createMessage({ 
      threadId: thread.id,
      content: 'Test message',
      role: 'user'
    })
    
    const modifiedMessage = { ...message, content: 'Modified message' }
    
    await extension.modifyMessage(modifiedMessage)
    
    const messages = await extension.listMessages(thread.id)
    expect(messages[0].content).toBe('Modified message')
  })

  test('should delete message', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    
    const message = await extension.createMessage({ 
      threadId: thread.id,
      content: 'Test message',
      role: 'user'
    })
    
    await extension.deleteMessage(thread.id, message.id)
    
    const messages = await extension.listMessages(thread.id)
    expect(messages).toHaveLength(0)
  })

  test('should create and get thread assistant', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    
    const assistant: ThreadAssistantInfo = {
      threadId: thread.id,
      modelId: 'test-model'
    }
    
    await extension.createThreadAssistant(thread.id, assistant)
    
    const retrievedAssistant = await extension.getThreadAssistant(thread.id)
    expect(retrievedAssistant.modelId).toBe('test-model')
  })

  test('should modify thread assistant', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    
    const assistant: ThreadAssistantInfo = {
      threadId: thread.id,
      modelId: 'test-model'
    }
    
    await extension.createThreadAssistant(thread.id, assistant)
    
    const modifiedAssistant: ThreadAssistantInfo = {
      threadId: thread.id,
      modelId: 'modified-model'
    }
    
    await extension.modifyThreadAssistant(thread.id, modifiedAssistant)
    
    const retrievedAssistant = await extension.getThreadAssistant(thread.id)
    expect(retrievedAssistant.modelId).toBe('modified-model')
  })

  test('should delete thread assistant when thread is deleted', async () => {
    const thread = await extension.createThread({ name: 'Test Thread' })
    
    const assistant: ThreadAssistantInfo = {
      threadId: thread.id,
      modelId: 'test-model'
    }
    
    await extension.createThreadAssistant(thread.id, assistant)
    await extension.deleteThread(thread.id)
    
    // Creating a new thread with the same ID to test if assistant was deleted
    const newThread = await extension.createThread({ id: thread.id, name: 'New Thread' })
    const retrievedAssistant = await extension.getThreadAssistant(newThread.id)
    
    expect(retrievedAssistant.modelId).toBe('')
  })
})
