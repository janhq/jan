import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ThreadMessage } from '@janhq/core'
import { DefaultMessagesService } from '../messages/default'

// The service calls the backend routes on window.core.api directly; no
// extension has to be registered for messages to work.
const api = {
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  modifyMessage: vi.fn(),
  deleteMessage: vi.fn(),
}

const message = (over: Partial<ThreadMessage> = {}) =>
  ({ id: 'msg-1', thread_id: 'thread-123', role: 'user', ...over }) as ThreadMessage

describe('DefaultMessagesService', () => {
  let messagesService: DefaultMessagesService
  const originalCore = window.core

  beforeEach(() => {
    messagesService = new DefaultMessagesService()
    vi.clearAllMocks()
    window.core = { api } as unknown as typeof window.core
  })

  afterEach(() => {
    window.core = originalCore
  })

  describe('fetchMessages', () => {
    it('should fetch messages successfully', async () => {
      const threadId = 'thread-123'
      const mockMessages = [message(), message({ id: 'msg-2', role: 'assistant' })]
      api.listMessages.mockResolvedValue(mockMessages)

      const result = await messagesService.fetchMessages(threadId)

      expect(api.listMessages).toHaveBeenCalledWith({ threadId })
      expect(result).toEqual(mockMessages)
    })

    it('should return empty array when the backend is unavailable', async () => {
      window.core = undefined

      expect(await messagesService.fetchMessages('thread-123')).toEqual([])
    })

    it('should return empty array when listMessages fails', async () => {
      api.listMessages.mockRejectedValue(new Error('Failed to list messages'))

      const result = await messagesService.fetchMessages('thread-123')

      expect(api.listMessages).toHaveBeenCalledWith({ threadId: 'thread-123' })
      expect(result).toEqual([])
    })

    it('should handle undefined listMessages response', async () => {
      api.listMessages.mockReturnValue(undefined)

      expect(await messagesService.fetchMessages('thread-123')).toEqual([])
    })
  })

  describe('createMessage', () => {
    it('should create message successfully', async () => {
      const msg = message()
      api.createMessage.mockResolvedValue(msg)

      const result = await messagesService.createMessage(msg)

      expect(api.createMessage).toHaveBeenCalledWith({ message: msg })
      expect(result).toEqual(msg)
    })

    it('should return original message when the backend is unavailable', async () => {
      window.core = undefined
      const msg = message()

      expect(await messagesService.createMessage(msg)).toBe(msg)
    })

    it('should return original message when createMessage fails', async () => {
      const msg = message()
      api.createMessage.mockRejectedValue(new Error('Failed to create message'))

      expect(await messagesService.createMessage(msg)).toBe(msg)
    })

    it('should keep the original message when the backend returns nothing (web build)', async () => {
      const msg = message()
      api.createMessage.mockResolvedValue(null)
      api.modifyMessage.mockResolvedValue(null)
      api.listMessages.mockResolvedValue(null)

      expect(await messagesService.createMessage(msg)).toBe(msg)
      expect(await messagesService.modifyMessage(msg)).toBe(msg)
      expect(await messagesService.fetchMessages('thread-123')).toEqual([])
    })

    it('should handle undefined createMessage response', async () => {
      const msg = message()
      api.createMessage.mockReturnValue(undefined)

      expect(await messagesService.createMessage(msg)).toBe(msg)
    })
  })

  describe('deleteMessage', () => {
    it('should delete message successfully', async () => {
      api.deleteMessage.mockResolvedValue(undefined)

      const result = await messagesService.deleteMessage('thread-123', 'msg-1')

      expect(api.deleteMessage).toHaveBeenCalledWith({
        threadId: 'thread-123',
        messageId: 'msg-1',
      })
      expect(result).toBeUndefined()
    })

    it('should return undefined when the backend is unavailable', async () => {
      window.core = undefined

      expect(
        await messagesService.deleteMessage('thread-123', 'msg-1')
      ).toBeUndefined()
    })

    it('should propagate deleteMessage errors', async () => {
      api.deleteMessage.mockRejectedValue(new Error('Failed to delete message'))

      await expect(
        messagesService.deleteMessage('thread-123', 'msg-1')
      ).rejects.toThrow('Failed to delete message')
    })
  })
})
