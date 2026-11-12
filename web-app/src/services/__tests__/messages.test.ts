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

    it('rejects when the backend is unavailable rather than acknowledging a fictitious write', async () => {
      window.core = undefined

      await expect(messagesService.createMessage(message())).rejects.toThrow(
        'Message storage is unavailable'
      )
    })

    it('propagates createMessage storage failures', async () => {
      const msg = message()
      api.createMessage.mockRejectedValue(new Error('Failed to create message'))

      await expect(messagesService.createMessage(msg)).rejects.toThrow(
        'Failed to create message'
      )
      expect(api.createMessage).toHaveBeenCalledWith({ message: msg })
    })

    it('rejects when the backend persisted nothing', async () => {
      const msg = message()
      api.createMessage.mockResolvedValue(null)
      api.modifyMessage.mockResolvedValue(null)
      api.listMessages.mockResolvedValue(null)

      await expect(messagesService.createMessage(msg)).rejects.toThrow(
        'Message storage is unavailable'
      )
      await expect(messagesService.modifyMessage(msg)).rejects.toThrow(
        'Message storage is unavailable'
      )
      expect(await messagesService.fetchMessages('thread-123')).toEqual([])
    })

    it('rejects a missing createMessage operation result', async () => {
      api.createMessage.mockReturnValue(undefined)

      await expect(messagesService.createMessage(message())).rejects.toThrow(
        'Message storage is unavailable'
      )
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
