// useCreateNewThread.test.ts
import { renderHook, act } from '@testing-library/react'
import { useCreateNewThread } from './useCreateNewThread'
import { useAtomValue, useSetAtom } from 'jotai'
import { useActiveModel } from './useActiveModel'
import useRecommendedModel from './useRecommendedModel'
import useSetActiveThread from './useSetActiveThread'
import { extensionManager } from '@/extension'
import { toaster } from '@/containers/Toast'

// Mock the dependencies
jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')
  return {
    ...originalModule,
    useAtomValue: jest.fn(),
    useSetAtom: jest.fn(),
  }
})
jest.mock('./useActiveModel')
jest.mock('./useRecommendedModel')
jest.mock('./useSetActiveThread')
jest.mock('@/extension')
jest.mock('@/containers/Toast')

describe('useCreateNewThread', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should create a new thread', async () => {
    const mockSetAtom = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(mockSetAtom)
    ;(useAtomValue as jest.Mock).mockReturnValue({
      metadata: {},
      assistants: [
        {
          id: 'assistant1',
          name: 'Assistant 1',
          instructions: undefined,
        },
      ],
    })
    ;(useActiveModel as jest.Mock).mockReturnValue({ stopInference: jest.fn() })
    ;(useRecommendedModel as jest.Mock).mockReturnValue({
      recommendedModel: { id: 'model1', parameters: [], settings: [] },
      downloadedModels: [],
    })
    ;(useSetActiveThread as jest.Mock).mockReturnValue({
      setActiveThread: jest.fn(),
    })
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      saveThread: jest.fn(),
    })

    const { result } = renderHook(() => useCreateNewThread())

    await act(async () => {
      await result.current.requestCreateNewThread({
        id: 'assistant1',
        name: 'Assistant 1',
        model: {
          id: 'model1',
          parameters: [],
          settings: [],
        },
      } as any)
    })

    expect(extensionManager.get).toHaveBeenCalled()
  })

  it('should create a new thread with instructions', async () => {
    const mockSetAtom = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(mockSetAtom)
    ;(useAtomValue as jest.Mock).mockReturnValueOnce(false)
    ;(useAtomValue as jest.Mock).mockReturnValue({
      metadata: {},
      assistants: [
        {
          id: 'assistant1',
          name: 'Assistant 1',
          instructions: 'Hello Jan',
        },
      ],
    })
    ;(useAtomValue as jest.Mock).mockReturnValueOnce(false)
    ;(useActiveModel as jest.Mock).mockReturnValue({ stopInference: jest.fn() })
    ;(useRecommendedModel as jest.Mock).mockReturnValue({
      recommendedModel: { id: 'model1', parameters: [], settings: [] },
      downloadedModels: [],
    })
    ;(useSetActiveThread as jest.Mock).mockReturnValue({
      setActiveThread: jest.fn(),
    })
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      saveThread: jest.fn(),
    })

    const { result } = renderHook(() => useCreateNewThread())

    await act(async () => {
      await result.current.requestCreateNewThread({
        id: 'assistant1',
        name: 'Assistant 1',
        instructions: 'Hello Jan Assistant',
        model: {
          id: 'model1',
          parameters: [],
          settings: [],
        },
      } as any)
    })

    expect(extensionManager.get).toHaveBeenCalled()
  })

  it('should create a new thread with previous instructions', async () => {
    const mockSetAtom = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(mockSetAtom)
    ;(useAtomValue as jest.Mock).mockReturnValueOnce(true)
    ;(useAtomValue as jest.Mock).mockReturnValueOnce({
      metadata: {},
      assistants: [
        {
          id: 'assistant1',
          name: 'Assistant 1',
          instructions: 'Hello Jan',
        },
      ],
    })
    ;(useAtomValue as jest.Mock).mockReturnValueOnce(true)
    ;(useActiveModel as jest.Mock).mockReturnValue({ stopInference: jest.fn() })
    ;(useRecommendedModel as jest.Mock).mockReturnValue({
      recommendedModel: { id: 'model1', parameters: [], settings: [] },
      downloadedModels: [],
    })
    ;(useSetActiveThread as jest.Mock).mockReturnValue({
      setActiveThread: jest.fn(),
    })
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      saveThread: jest.fn(),
    })

    const { result } = renderHook(() => useCreateNewThread())

    await act(async () => {
      await result.current.requestCreateNewThread({
        id: 'assistant1',
        name: 'Assistant 1',
        model: {
          id: 'model1',
          parameters: [],
          settings: [],
        },
      } as any)
    })

    expect(extensionManager.get).toHaveBeenCalled()
  })

  it('should show a warning toast if trying to create an empty thread', async () => {
    ;(useAtomValue as jest.Mock).mockReturnValue([{ metadata: {} }]) // Mock an empty thread
    ;(useRecommendedModel as jest.Mock).mockReturnValue({
      recommendedModel: null,
      downloadedModels: [],
    })

    const { result } = renderHook(() => useCreateNewThread())

    await act(async () => {
      await result.current.requestCreateNewThread({
        id: 'assistant1',
        name: 'Assistant 1',
        tools: [],
      } as any)
    })

    expect(toaster).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'No new thread created.',
        type: 'warning',
      })
    )
  })

  it('should update thread metadata', async () => {
    const mockUpdateThread = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(mockUpdateThread)
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      saveThread: jest.fn(),
    })

    const { result } = renderHook(() => useCreateNewThread())

    const mockThread = { id: 'thread1', title: 'Test Thread', assistants: [{}] }

    await act(async () => {
      await result.current.updateThreadMetadata(mockThread as any)
    })

    expect(mockUpdateThread).toHaveBeenCalledWith(mockThread)
  })
})
