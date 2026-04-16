import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultMessagesService } from '../default'

const mockListMessages = vi.fn()
const mockCreateMessage = vi.fn()
const mockModifyMessage = vi.fn()
const mockDeleteMessage = vi.fn()

const mockExtension = {
  listMessages: mockListMessages,
  createMessage: mockCreateMessage,
  modifyMessage: mockModifyMessage,
  deleteMessage: mockDeleteMessage,
}

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => mockExtension,
    }),
  },
}))

vi.mock('@janhq/core', () => ({
  ConversationalExtension: class {},
  ExtensionTypeEnum: { Conversational: 'conversational' },
}))

vi.mock('@/constants/chat', () => ({
  TEMPORARY_CHAT_ID: 'temporary-chat',
}))

describe('DefaultMessagesService', () => {
  let svc: DefaultMessagesService

  beforeEach(() => {
    svc = new DefaultMessagesService()
    vi.clearAllMocks()
  })

  describe('fetchMessages', () => {
    it('returns empty array for temporary chat', async () => {
      const result = await svc.fetchMessages('temporary-chat')
      expect(result).toEqual([])
      expect(mockListMessages).not.toHaveBeenCalled()
    })

    it('fetches messages from extension for real thread', async () => {
      mockListMessages.mockResolvedValue([{ id: 'msg1' }])
      const result = await svc.fetchMessages('thread-1')
      expect(result).toEqual([{ id: 'msg1' }])
    })

    it('returns empty array on extension error', async () => {
      mockListMessages.mockRejectedValue(new Error('fail'))
      const result = await svc.fetchMessages('thread-1')
      expect(result).toEqual([])
    })
  })

  describe('createMessage', () => {
    it('returns message without calling extension for temporary chat', async () => {
      const msg = { thread_id: 'temporary-chat', id: 'msg1' } as any
      const result = await svc.createMessage(msg)
      expect(result).toBe(msg)
      expect(mockCreateMessage).not.toHaveBeenCalled()
    })

    it('creates message via extension for real thread', async () => {
      const msg = { thread_id: 'thread-1', id: 'msg1' } as any
      mockCreateMessage.mockResolvedValue({ ...msg, created: true })
      const result = await svc.createMessage(msg)
      expect(result).toEqual({ ...msg, created: true })
    })

    it('returns original message on extension error', async () => {
      const msg = { thread_id: 'thread-1', id: 'msg1' } as any
      mockCreateMessage.mockRejectedValue(new Error('fail'))
      const result = await svc.createMessage(msg)
      expect(result).toBe(msg)
    })
  })

  describe('modifyMessage', () => {
    it('returns message without calling extension for temporary chat', async () => {
      const msg = { thread_id: 'temporary-chat', id: 'msg1' } as any
      const result = await svc.modifyMessage(msg)
      expect(result).toBe(msg)
      expect(mockModifyMessage).not.toHaveBeenCalled()
    })

    it('modifies message via extension for real thread', async () => {
      const msg = { thread_id: 'thread-1', id: 'msg1' } as any
      mockModifyMessage.mockResolvedValue({ ...msg, modified: true })
      const result = await svc.modifyMessage(msg)
      expect(result).toEqual({ ...msg, modified: true })
    })

    it('returns original message on extension error', async () => {
      const msg = { thread_id: 'thread-1', id: 'msg1' } as any
      mockModifyMessage.mockRejectedValue(new Error('fail'))
      const result = await svc.modifyMessage(msg)
      expect(result).toBe(msg)
    })
  })

  describe('deleteMessage', () => {
    it('returns without calling extension for temporary chat', async () => {
      await svc.deleteMessage('temporary-chat', 'msg1')
      expect(mockDeleteMessage).not.toHaveBeenCalled()
    })

    it('deletes message via extension for real thread', async () => {
      mockDeleteMessage.mockResolvedValue(undefined)
      await svc.deleteMessage('thread-1', 'msg1')
      expect(mockDeleteMessage).toHaveBeenCalledWith('thread-1', 'msg1')
    })
  })
})
