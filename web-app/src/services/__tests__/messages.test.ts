import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultMessagesService } from '../messages/default'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum } from '@janhq/core'

// Mock the ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(() => ({
      get: vi.fn()
    }))
  }
}))

describe('DefaultMessagesService', () => {
  let messagesService: DefaultMessagesService
  
  const mockExtension = {
    listMessages: vi.fn(),
    createMessage: vi.fn(),
    deleteMessage: vi.fn()
  }

  const mockExtensionManager = {
    get: vi.fn()
  }

  beforeEach(() => {
    messagesService = new DefaultMessagesService()
    vi.clearAllMocks()
    vi.mocked(ExtensionManager.getInstance).mockReturnValue(mockExtensionManager)
    mockExtensionManager.get.mockReturnValue(mockExtension)
  })

  describe('fetchMessages', () => {
    it('should fetch messages successfully', async () => {
      const threadId = 'thread-123'
      const mockMessages = [
        { id: 'msg-1', threadId, content: 'Hello', role: 'user' },
        { id: 'msg-2', threadId, content: 'Hi there!', role: 'assistant' }
      ]
      mockExtension.listMessages.mockResolvedValue(mockMessages)

      const result = await messagesService.fetchMessages(threadId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(mockExtension.listMessages).toHaveBeenCalledWith(threadId)
      expect(result).toEqual(mockMessages)
    })

    it('should return empty array when extension not found', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const threadId = 'thread-123'

      const result = await messagesService.fetchMessages(threadId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(result).toEqual([])
    })

    it('should return empty array when listMessages fails', async () => {
      const threadId = 'thread-123'
      const error = new Error('Failed to list messages')
      mockExtension.listMessages.mockRejectedValue(error)

      const result = await messagesService.fetchMessages(threadId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(mockExtension.listMessages).toHaveBeenCalledWith(threadId)
      expect(result).toEqual([])
    })

    it('should handle undefined listMessages response', async () => {
      const threadId = 'thread-123'
      mockExtension.listMessages.mockReturnValue(undefined)

      const result = await messagesService.fetchMessages(threadId)

      expect(result).toEqual([])
    })
  })

  describe('createMessage', () => {
    it('should create message successfully', async () => {
      const message = { id: 'msg-1', threadId: 'thread-123', content: 'Hello', role: 'user' }
      mockExtension.createMessage.mockResolvedValue(message)

      const result = await messagesService.createMessage(message)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(mockExtension.createMessage).toHaveBeenCalledWith(message)
      expect(result).toEqual(message)
    })

    it('should return original message when extension not found', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const message = { id: 'msg-1', threadId: 'thread-123', content: 'Hello', role: 'user' }

      const result = await messagesService.createMessage(message)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(result).toEqual(message)
    })

    it('should return original message when createMessage fails', async () => {
      const message = { id: 'msg-1', threadId: 'thread-123', content: 'Hello', role: 'user' }
      const error = new Error('Failed to create message')
      mockExtension.createMessage.mockRejectedValue(error)

      const result = await messagesService.createMessage(message)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(mockExtension.createMessage).toHaveBeenCalledWith(message)
      expect(result).toEqual(message)
    })

    it('should handle undefined createMessage response', async () => {
      const message = { id: 'msg-1', threadId: 'thread-123', content: 'Hello', role: 'user' }
      mockExtension.createMessage.mockReturnValue(undefined)

      const result = await messagesService.createMessage(message)

      expect(result).toEqual(message)
    })
  })

  describe('deleteMessage', () => {
    it('should delete message successfully', async () => {
      const threadId = 'thread-123'
      const messageId = 'msg-1'
      mockExtension.deleteMessage.mockResolvedValue(undefined)

      const result = await messagesService.deleteMessage(threadId, messageId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(mockExtension.deleteMessage).toHaveBeenCalledWith(threadId, messageId)
      expect(result).toBeUndefined()
    })

    it('should return undefined when extension not found', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const threadId = 'thread-123'
      const messageId = 'msg-1'

      const result = await messagesService.deleteMessage(threadId, messageId)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Conversational)
      expect(result).toBeUndefined()
    })

    it('should handle deleteMessage error', async () => {
      const threadId = 'thread-123'
      const messageId = 'msg-1'
      const error = new Error('Failed to delete message')
      mockExtension.deleteMessage.mockRejectedValue(error)

      // Since deleteMessage doesn't have error handling, the error will propagate
      await expect(messagesService.deleteMessage(threadId, messageId)).rejects.toThrow('Failed to delete message')
    })
  })
})