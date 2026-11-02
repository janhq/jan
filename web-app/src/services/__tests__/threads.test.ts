import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultThreadsService } from '../threads/default'
import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@janhq/core'

// Mock ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
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

    it('should default provider to llamacpp when engine is missing in stored thread', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue([
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
      mockConversationalExtension.listThreads.mockResolvedValue([])

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('rejects a null/undefined response (not-ready), never an empty listing', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue(null)
      await expect(threadsService.fetchThreads()).rejects.toThrow(/non-array/)
      mockConversationalExtension.listThreads.mockResolvedValue(undefined)
      await expect(threadsService.fetchThreads()).rejects.toThrow(/non-array/)
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

      mockConversationalExtension.createThread.mockRejectedValue(
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
    it('should throw when the conversational extension is not ready (startup race)', async () => {
      ;(ExtensionManager.getInstance as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      })

      await expect(threadsService.fetchThreads()).rejects.toThrow()
    })

    it('should propagate listThreads failures instead of resolving to an empty list', async () => {
      mockConversationalExtension.listThreads.mockRejectedValue(
        new Error('invoke failed')
      )

      await expect(threadsService.fetchThreads()).rejects.toThrow(
        'invoke failed'
      )
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
          // missing metadata and assistants
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
        assistants: [{ id: 'model-only', name: 'Model', model: { id: 'gpt-4', engine: 'openai' } }],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      // Should create with model-only entry when no assistants provided
      expect(mockConversationalExtension.createThread).toHaveBeenCalledWith(
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

    it('throws on a non-array response instead of coercing it to an empty listing', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue('not-an-array')

      await expect(threadsService.fetchThreads()).rejects.toThrow(/non-array/)
    })

    it('still returns [] for a genuine empty array response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue([])

      await expect(threadsService.fetchThreads()).resolves.toEqual([])
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

describe('conversation capability persistence', () => {
  const invoke = vi.hoisted(() => vi.fn())
  vi.mock('@/hooks/useServiceHub', () => ({
    getServiceHub: () => ({ core: () => ({ invoke }) }),
  }))
  const grants = { version: 1 as const, folderScope: null, shellNetwork: true, memoryWrite: false }

  beforeEach(() => invoke.mockReset())

  it('uses only the dedicated native patch, not the extension', async () => {
    await new DefaultThreadsService().setConversationCapabilities('thread-1', grants)
    expect(invoke).toHaveBeenCalledWith('set_thread_conversation_capabilities', {
      threadId: 'thread-1', value: grants,
    })
  })
  it('resolves malformed and unknown-version input fail closed', async () => {
    await new DefaultThreadsService().setConversationCapabilities('thread-1', { ...grants, version: 2 } as never)
    expect(invoke).toHaveBeenCalledWith('set_thread_conversation_capabilities', {
      threadId: 'thread-1', value: { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false },
    })
  })
  it('propagates native errors', async () => {
    invoke.mockRejectedValueOnce(new Error('deleted thread'))
    await expect(new DefaultThreadsService().setConversationCapabilities('thread-1', grants)).rejects.toThrow('deleted thread')
  })
  it('does not persist temporary conversation consent', async () => {
    await expect(new DefaultThreadsService().setConversationCapabilities('temporary-chat', grants)).rejects.toThrow('regular chat')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('rolls back using the raw successful creation response, not UI-transformed metadata', async () => {
    const raw = { id: 'new-chat', title: 'Draft', created: 7, updated: 8, assistants: [{ id: 'model-only', model: { id: 'm', engine: 'provider' } }], metadata: { order: 3, project: { id: 'p' } } }
    const createThread = vi.fn().mockResolvedValue(raw)
    vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: () => ({ createThread }) } as never)
    const service = new DefaultThreadsService()
    const created = await service.createThread({ id: 'new-chat', title: 'Draft', updated: 8, model: { id: 'm', provider: 'provider' } })
    expect(created.model).toEqual({ id: 'm', provider: 'provider' })
    await service.rollbackCreatedThread('new-chat', created)
    expect(invoke).toHaveBeenCalledWith('rollback_created_thread', { threadId: 'new-chat', expected: raw })
    await expect(service.rollbackCreatedThread('new-chat', created)).rejects.toThrow('receipt')
  })

  it('rejects missing/failed creation receipts without invoking delete', async () => {
    const service = new DefaultThreadsService()
    const input = { id: 'uncreated', updated: 1 }
    vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: () => undefined } as never)
    const created = await service.createThread(input)
    await expect(service.rollbackCreatedThread('uncreated', created)).rejects.toThrow('receipt')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('propagates guarded rollback errors and retains receipt for retry', async () => {
    const raw = { id: 'retry-chat', title: 'Draft', updated: 8 }
    vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: () => ({ createThread: vi.fn().mockResolvedValue(raw) }) } as never)
    const service = new DefaultThreadsService()
    const created = await service.createThread(raw)
    invoke.mockRejectedValueOnce(new Error('changed on disk'))
    await expect(service.rollbackCreatedThread('retry-chat', created)).rejects.toThrow('changed on disk')
    await service.rollbackCreatedThread('retry-chat', created)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('acceptance releases raw creation rollback receipt', async () => {
    const raw = { id: 'accepted-chat', updated: 1 }
    vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: () => ({ createThread: vi.fn().mockResolvedValue(raw) }) } as never)
    const service = new DefaultThreadsService()
    const created = await service.createThread(raw)
    service.releaseCreatedThread(created)
    await expect(service.rollbackCreatedThread(created.id, created)).rejects.toThrow('receipt')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('strict creation rejects actual unavailable or failing persistence while legacy fallback remains', async () => {
    const service = new DefaultThreadsService()
    const input = { id: 'strict-create', title: 'Draft', updated: 1 }
    vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: () => undefined } as never)
    await expect(service.createThread(input, { strict: true })).rejects.toThrow('unavailable')
    await expect(service.createThread(input)).resolves.toBe(input)
    vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: () => ({ createThread: vi.fn().mockRejectedValue(new Error('disk error')) }) } as never)
    await expect(service.createThread(input, { strict: true })).rejects.toThrow('disk error')
    await expect(service.createThread(input)).resolves.toBe(input)
    await expect(service.rollbackCreatedThread(input.id, input)).rejects.toThrow('receipt')
    expect(invoke).not.toHaveBeenCalled()
  })

})
