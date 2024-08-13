/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import 'openai/shims/web'

import { renderHook, act } from '@testing-library/react-hooks'

import useAssistantQuery from '../../hooks/useAssistantQuery'
import useCortex from '../../hooks/useCortex'
import useMessageCreateMutation from '../../hooks/useMessageCreateMutation'
import useMigratingData from '../../hooks/useMigratingData'
import useThreads from '../../hooks/useThreads'

jest.mock('../../hooks/useAssistantQuery')
jest.mock('../../hooks/useCortex')
jest.mock('../../hooks/useMessageCreateMutation')
jest.mock('../../hooks/useThreads')

describe('useMigratingData', () => {
  const mockCreateThread = jest.fn()
  const mockUpdateThread = jest.fn()
  const mutateAsync = jest.fn()
  const mockGetAllMessagesAndThreads = jest.fn()
  const mockGetAllLocalModels = jest.fn()
  const mockSyncModelFileToCortex = jest.fn()

  beforeEach(() => {
    
    useThreads.mockReturnValue({ createThread: mockCreateThread, updateThread: mockUpdateThread })
    useCortex.mockReturnValue({ updateThread: mockUpdateThread })
    useMessageCreateMutation.mockReturnValue({ mutateAsync: mutateAsync })
    mockCreateThread.mockReturnValue({ id: 'thread1', assistants: [{ model: { id: 'model1' } }], title: 'Thread 1' })
    useAssistantQuery.mockReturnValue({ data: [{ id: 'assistant1' }] })
    window.electronAPI = {
      getAllMessagesAndThreads: mockGetAllMessagesAndThreads,
      getAllLocalModels: mockGetAllLocalModels,
      syncModelFileToCortex: mockSyncModelFileToCortex,
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should migrate threads and messages', async () => {
    mockGetAllMessagesAndThreads.mockResolvedValue({
      messages: [
        {
          thread_id: 'thread1',
          role: 'user',
          content: [{ text: { value: 'message1' } }],
        },
      ],
      threads: [
        {
          id: 'thread1',
          assistants: [
            { model: { id: 'model1' }, instructions: 'instructions1' },
          ],
          title: 'Thread 1',
        },
      ],
    } as never)

    const { result } = renderHook(() => useMigratingData())

    await act(async () => {
      await result.current.migrateThreadsAndMessages()
    })

    expect(mockCreateThread).toHaveBeenCalledWith('model1', {
      id: 'assistant1',
    })
    expect(mockUpdateThread).toHaveBeenCalled()
    expect(mutateAsync).toHaveBeenCalledWith({
      threadId: 'thread1',
      createMessageParams: {
        content: 'message1',
        role: 'user',
      },
    })
  })

  it('should migrate models', async () => {
    const { result } = renderHook(() => useMigratingData())

    await act(async () => {
      await result.current.migrateModels()
    })

    expect(mockSyncModelFileToCortex).toHaveBeenCalled()
  })

  it('should get Jan threads and messages', async () => {
    const { result } = renderHook(() => useMigratingData())

    await act(async () => {
      await result.current.getJanThreadsAndMessages()
    })

    expect(mockGetAllMessagesAndThreads).toHaveBeenCalled()
  })

  it('should get Jan local models', async () => {
    const { result } = renderHook(() => useMigratingData())

    await act(async () => {
      await result.current.getJanLocalModels()
    })

    expect(mockGetAllLocalModels).toHaveBeenCalled()
  })

  it('should handle empty local models', async () => {
    mockGetAllLocalModels.mockResolvedValue(false)
  
    const { result } = renderHook(() => useMigratingData())
  
    await act(async () => {
      await result.current.getJanLocalModels()
    })
  
    expect(mockGetAllLocalModels).toHaveBeenCalled()
    expect(mockSyncModelFileToCortex).not.toHaveBeenCalled()
  })
  

  it('should handle no assistants found during migration', async () => {
    useAssistantQuery.mockReturnValue({ data: [] })
  
    const { result } = renderHook(() => useMigratingData())
  
    await act(async () => {
      await result.current.migrateThreadsAndMessages()
    })
  
    expect(mockCreateThread).not.toHaveBeenCalled()
    expect(mockUpdateThread).not.toHaveBeenCalled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
  
  it('should handle empty threads and messages', async () => {
    mockGetAllMessagesAndThreads.mockResolvedValue({
      messages: [],
      threads: [],
    } as never)
  
    const { result } = renderHook(() => useMigratingData())
  
    await act(async () => {
      await result.current.migrateThreadsAndMessages()
    })
  
    expect(mockCreateThread).not.toHaveBeenCalled()
    expect(mockUpdateThread).not.toHaveBeenCalled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
  
})
