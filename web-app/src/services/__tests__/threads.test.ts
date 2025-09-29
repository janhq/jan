import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultThreadsService } from '../threads/default'
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

describe('DefaultThreadsService', () => {
  let threadsService: DefaultThreadsService
  
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
    threadsService = new DefaultThreadsService()
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

      const result = await threadsService.fetchThreads()

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

    it('should migrate old threads properly', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567880000,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
        {
          id: '2',
          title: 'Test Thread 2',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567880,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
      expect(result[1]).toMatchObject({
        id: '2',
        title: 'Test Thread 2',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })

    it('should handle empty threads array', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue([])

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle error and return empty array', async () => {
      mockConversationalExtension.listThreads.mockRejectedValue(
        new Error('API Error')
      )

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle null/undefined response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue(null)

      const result = await threadsService.fetchThreads()

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

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

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

      mockConversationalExtension.createThread.mockRejectedValue(
        new Error('Creation failed')
      )

      const result = await threadsService.createThread(inputThread as Thread)

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

      const result = threadsService.updateThread(thread as Thread)

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

      threadsService.deleteThread(threadId)

      expect(mockConversationalExtension.deleteThread).toHaveBeenCalledWith(
        threadId
      )
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle fetchThreads when extension manager returns null', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle createThread when extension manager returns null', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      const inputThread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toEqual(inputThread)
    })

    it('should handle updateThread when extension manager returns null', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      const thread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      const result = await threadsService.updateThread(thread as Thread)

      expect(result).toBeUndefined()
    })

    it('should handle deleteThread when extension manager returns null', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      const result = await threadsService.deleteThread('test-id')

      expect(result).toBeUndefined()
    })

    it('should handle fetchThreads with threads missing metadata', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          // missing metadata
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 0,
        order: undefined,
        isFavorite: undefined,
        assistants: [defaultAssistant],
      })
    })

    it('should handle fetchThreads with threads missing assistants', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          // missing assistants
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
        assistants: [defaultAssistant],
      })
    })

    it('should handle createThread with missing model info', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        // missing model
        assistants: [defaultAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ model: { id: '*', engine: 'llamacpp' } }],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(mockConversationalExtension.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              model: { id: '*', engine: 'llamacpp' },
            }),
          ],
        })
      )
    })

    it('should handle createThread with missing assistants', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        // missing assistants
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(mockConversationalExtension.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              ...defaultAssistant,
              model: { id: 'gpt-4', engine: 'openai' },
            }),
          ],
        })
      )
    })

    it('should handle updateThread with missing assistants', () => {
      const thread = {
        id: '1',
        title: 'Updated Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        // missing assistants
        isFavorite: true,
        order: 2,
      }

      threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            {
              model: { id: 'gpt-4', engine: 'openai' },
              id: 'jan',
              name: 'Jan',
            },
          ],
        })
      )
    })

    it('should handle updateThread with missing model info', () => {
      const thread = {
        id: '1',
        title: 'Updated Thread',
        // missing model
        assistants: [defaultAssistant],
        isFavorite: true,
        order: 2,
      }

      threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              model: { id: '*', engine: 'llamacpp' },
            }),
          ],
        })
      )
    })

    it('should handle fetchThreads with non-array response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue('not-an-array')

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle createThread with missing metadata in response', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        // missing metadata
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toMatchObject({
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1, // Should fall back to original thread order
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })
  })
})
