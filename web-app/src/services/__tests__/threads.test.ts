import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DefaultThreadsService } from '../threads/default'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

// The service calls the backend routes on window.core.api directly; no
// extension has to be registered for threads to work.
const api = {
  listThreads: vi.fn(),
  createThread: vi.fn(),
  modifyThread: vi.fn(),
  deleteThread: vi.fn(),
}

describe('DefaultThreadsService', () => {
  let threadsService: DefaultThreadsService

  const originalCore = window.core
  // The routes take the thread wrapped as `{ thread }`.
  const sentThread = (route: ReturnType<typeof vi.fn>) =>
    route.mock.calls[0][0].thread

  beforeEach(() => {
    threadsService = new DefaultThreadsService()
    vi.clearAllMocks()
    window.core = { api } as unknown as typeof window.core
  })

  afterEach(() => {
    window.core = originalCore
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

      api.listThreads.mockResolvedValue(mockThreads)

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

      api.listThreads.mockResolvedValue(mockThreads)

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

    it('should default provider to llamacpp when engine is missing in stored thread', async () => {
      api.listThreads.mockResolvedValue([
        {
          id: '1',
          title: 'T',
          updated: 0,
          assistants: [{ model: { id: 'my-model' } }],
        },
      ])
      const result = await threadsService.fetchThreads()
      expect(result[0].model).toEqual({ id: 'my-model', provider: 'llamacpp' })
    })

    it('should handle empty threads array', async () => {
      api.listThreads.mockResolvedValue([])

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle null/undefined response', async () => {
      api.listThreads.mockResolvedValue(null)

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })
  })

  describe('createThread', () => {
    it('should create thread successfully', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [realAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ ...realAssistant, model: { id: 'gpt-4', engine: 'openai' } }],
        metadata: { order: 1 },
      }

      api.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toMatchObject({
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1,
        // Real assistants (with instructions) are preserved
        assistants: [expect.objectContaining({ instructions: 'You are a helpful assistant.' })],
      })
    })

    it('should handle creation error and return original thread', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      api.createThread.mockRejectedValue(
        new Error('Creation failed')
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toEqual(inputThread)
    })
  })

  describe('updateThread', () => {
    it('should update thread successfully', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const thread = {
        id: '1',
        title: 'Updated Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [realAssistant],
        isFavorite: true,
        order: 2,
      }

      const result = threadsService.updateThread(thread as Thread)

      expect(sentThread(api.modifyThread)).toEqual(
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

      expect(api.deleteThread).toHaveBeenCalledWith({ threadId })
    })
  })

  describe('edge cases and error handling', () => {
    it('should fetch threads with no extension registered', async () => {
      api.listThreads.mockResolvedValue([{ id: '1', title: 'T', updated: 1 }])

      const result = await threadsService.fetchThreads()

      expect(api.listThreads).toHaveBeenCalledWith()
      expect(result.map((t) => t.id)).toEqual(['1'])
    })

    it('should filter out the temporary thread', async () => {
      api.listThreads.mockResolvedValue([
        { id: TEMPORARY_CHAT_ID, title: 'Temp', updated: 1 },
        { id: '1', title: 'T', updated: 1 },
      ])

      const result = await threadsService.fetchThreads()

      expect(result.map((t) => t.id)).toEqual(['1'])
    })

    it('should propagate listThreads failures instead of resolving to an empty list', async () => {
      api.listThreads.mockRejectedValue(new Error('invoke failed'))

      await expect(threadsService.fetchThreads()).rejects.toThrow(
        'invoke failed'
      )
    })

    it('should return the input thread when the backend is unavailable', async () => {
      window.core = undefined

      const inputThread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toEqual(inputThread)
    })

    it('should not touch the backend for the temporary thread', async () => {
      const temp = { id: TEMPORARY_CHAT_ID, title: 'Temp' } as Thread

      expect(await threadsService.createThread(temp)).toBe(temp)
      await threadsService.updateThread(temp)
      await threadsService.deleteThread(TEMPORARY_CHAT_ID)

      expect(api.createThread).not.toHaveBeenCalled()
      expect(api.modifyThread).not.toHaveBeenCalled()
      expect(api.deleteThread).not.toHaveBeenCalled()
    })

    it('should propagate modifyThread and deleteThread failures', async () => {
      api.modifyThread.mockRejectedValueOnce(new Error('modify failed'))
      api.deleteThread.mockRejectedValueOnce(new Error('delete failed'))

      await expect(
        threadsService.updateThread({ id: '1', title: 'T' } as Thread)
      ).rejects.toThrow('modify failed')
      await expect(threadsService.deleteThread('1')).rejects.toThrow(
        'delete failed'
      )
    })

    it('should handle fetchThreads with threads missing metadata', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          // missing metadata and assistants
        },
      ]

      api.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 0,
        order: undefined,
        isFavorite: undefined,
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

      api.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
      })
    })

    it('should handle createThread with missing model info', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const inputThread = {
        id: '1',
        title: 'New Thread',
        // missing model
        assistants: [realAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ ...realAssistant, model: { id: '*', engine: 'llamacpp' } }],
        metadata: { order: 1 },
      }

      api.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(sentThread(api.createThread)).toEqual(
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
        assistants: [{ id: 'model-only', name: 'Model', model: { id: 'gpt-4', engine: 'openai' } }],
        metadata: { order: 1 },
      }

      api.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      // Should create with model-only entry when no assistants provided
      expect(sentThread(api.createThread)).toEqual(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              id: 'model-only',
              name: 'Model',
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

      expect(sentThread(api.modifyThread)).toEqual(
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
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const thread = {
        id: '1',
        title: 'Updated Thread',
        // missing model
        assistants: [realAssistant],
        isFavorite: true,
        order: 2,
      }

      threadsService.updateThread(thread as Thread)

      expect(sentThread(api.modifyThread)).toEqual(
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
      api.listThreads.mockResolvedValue('not-an-array')

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

      api.createThread.mockResolvedValue(
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
