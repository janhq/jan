import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchThreads, createThread, updateThread, deleteThread } from '../threads'
import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@janhq/core'
import { defaultAssistant } from '@/hooks/useAssistant'

// Mock ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

vi.mock('@/hooks/useAssistant', () => ({
  defaultAssistant: {
    id: 'jan',
    name: 'Jan',
    instructions: 'You are a helpful assistant.',
  },
}))

describe('threads service', () => {
  const mockConversationalExtension = {
    listThreads: vi.fn(),
    createThread: vi.fn(),
    modifyThread: vi.fn(),
    deleteThread: vi.fn(),
  }

  const mockExtensionManager = {
    get: vi.fn().mockReturnValue(mockConversationalExtension),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(ExtensionManager.getInstance as any).mockReturnValue(mockExtensionManager)
  })

  describe('fetchThreads', () => {
    it('should fetch and transform threads successfully', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })

    it('should handle empty threads array', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue([])

      const result = await fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle error and return empty array', async () => {
      mockConversationalExtension.listThreads.mockRejectedValue(new Error('API Error'))

      const result = await fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle null/undefined response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue(null)

      const result = await fetchThreads()

      expect(result).toEqual([])
    })
  })

  describe('createThread', () => {
    it('should create thread successfully', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [defaultAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(mockCreatedThread)

      const result = await createThread(inputThread as Thread)

      expect(result).toMatchObject({
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1,
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })

    it('should handle creation error and return original thread', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      mockConversationalExtension.createThread.mockRejectedValue(new Error('Creation failed'))

      const result = await createThread(inputThread as Thread)

      expect(result).toEqual(inputThread)
    })
  })

  describe('updateThread', () => {
    it('should update thread successfully', async () => {
      const thread = {
        id: '1',
        title: 'Updated Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [defaultAssistant],
        isFavorite: true,
        order: 2,
      }

      const result = updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          title: 'Updated Thread',
          assistants: expect.arrayContaining([
            expect.objectContaining({
              model: { id: 'gpt-4', engine: 'openai' },
            }),
          ]),
          metadata: { is_favorite: true, order: 2 },
        })
      )
    })
  })

  describe('deleteThread', () => {
    it('should delete thread successfully', () => {
      const threadId = '1'

      deleteThread(threadId)

      expect(mockConversationalExtension.deleteThread).toHaveBeenCalledWith(threadId)
    })
  })
})