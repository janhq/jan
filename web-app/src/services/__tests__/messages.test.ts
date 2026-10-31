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

    it('rejects when extension is missing rather than acknowledging a fictitious write', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const message = { id: 'msg-1', threadId: 'thread-123', content: 'Hello', role: 'user' }
      await expect(messagesService.createMessage(message)).rejects.toThrow('Message storage is unavailable')
    })

    it('propagates createMessage storage failures', async () => {
      const message = { id: 'msg-1', threadId: 'thread-123', content: 'Hello', role: 'user' }
      mockExtension.createMessage.mockRejectedValue(new Error('Failed to create message'))
      await expect(messagesService.createMessage(message)).rejects.toThrow('Failed to create message')
      expect(mockExtension.createMessage).toHaveBeenCalledWith(message)
    })

    it('rejects a missing createMessage operation result', async () => {
      const message = { id: 'msg-1', threadId: 'thread-123', content: 'Hello', role: 'user' }
      mockExtension.createMessage.mockReturnValue(undefined)
      await expect(messagesService.createMessage(message)).rejects.toThrow('Message storage is unavailable')
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
