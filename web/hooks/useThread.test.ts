// useThreads.test.ts

import { renderHook, act } from '@testing-library/react'
import { useSetAtom } from 'jotai'
import { ExtensionTypeEnum } from '@janhq/core'
import { extensionManager } from '@/extension/ExtensionManager'
import useThreads from './useThreads'
import {
  threadDataReadyAtom,
  threadModelParamsAtom,
  threadsAtom,
  threadStatesAtom,
} from '@/helpers/atoms/Thread.atom'

// Mock the necessary dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))
jest.mock('@/extension/ExtensionManager')

describe('useThreads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const mockThreads = [
    {
      id: 'thread1',
      metadata: { lastMessage: 'Hello' },
      assistants: [
        {
          model: {
            parameters: { param1: 'value1' },
            settings: { setting1: 'value1' },
          },
        },
      ],
    },
    {
      id: 'thread2',
      metadata: { lastMessage: 'Hi there' },
      assistants: [
        {
          model: {
            parameters: { param2: 'value2' },
            settings: { setting2: 'value2' },
          },
        },
      ],
    },
  ]

  it('should fetch and set threads data', async () => {
    // Mock Jotai hooks
    const mockSetThreadStates = jest.fn()
    const mockSetThreads = jest.fn()
    const mockSetThreadModelRuntimeParams = jest.fn()
    const mockSetThreadDataReady = jest.fn()

    ;(useSetAtom as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case threadStatesAtom:
          return mockSetThreadStates
        case threadsAtom:
          return mockSetThreads
        case threadModelParamsAtom:
          return mockSetThreadModelRuntimeParams
        case threadDataReadyAtom:
          return mockSetThreadDataReady
        default:
          return jest.fn()
      }
    })

    // Mock extensionManager
    const mockGetThreads = jest.fn().mockResolvedValue(mockThreads)
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      listThreads: mockGetThreads,
    })

    const { result } = renderHook(() => useThreads())

    await act(async () => {
      // Wait for useEffect to complete
    })

    // Assertions
    expect(extensionManager.get).toHaveBeenCalledWith(
      ExtensionTypeEnum.Conversational
    )
    expect(mockGetThreads).toHaveBeenCalled()

    expect(mockSetThreadStates).toHaveBeenCalledWith({
      thread1: {
        hasMore: false,
        waitingForResponse: false,
        lastMessage: 'Hello',
      },
      thread2: {
        hasMore: false,
        waitingForResponse: false,
        lastMessage: 'Hi there',
      },
    })

    expect(mockSetThreads).toHaveBeenCalledWith(mockThreads)

    expect(mockSetThreadModelRuntimeParams).toHaveBeenCalledWith({
      thread1: { param1: 'value1', setting1: 'value1' },
      thread2: { param2: 'value2', setting2: 'value2' },
    })

    expect(mockSetThreadDataReady).toHaveBeenCalledWith(true)
  })

  it('should handle empty threads', async () => {
    // Mock empty threads
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      listThreads: jest.fn().mockResolvedValue([]),
    })

    const mockSetThreadStates = jest.fn()
    const mockSetThreads = jest.fn()
    const mockSetThreadModelRuntimeParams = jest.fn()
    const mockSetThreadDataReady = jest.fn()

    ;(useSetAtom as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case threadStatesAtom:
          return mockSetThreadStates
        case threadsAtom:
          return mockSetThreads
        case threadModelParamsAtom:
          return mockSetThreadModelRuntimeParams
        case threadDataReadyAtom:
          return mockSetThreadDataReady
        default:
          return jest.fn()
      }
    })

    const { result } = renderHook(() => useThreads())

    await act(async () => {
      // Wait for useEffect to complete
    })

    expect(mockSetThreadStates).toHaveBeenCalledWith({})
    expect(mockSetThreads).toHaveBeenCalledWith([])
    expect(mockSetThreadModelRuntimeParams).toHaveBeenCalledWith({})
    expect(mockSetThreadDataReady).toHaveBeenCalledWith(true)
  })

  it('should handle missing ConversationalExtension', async () => {
    // Mock missing ConversationalExtension
    ;(extensionManager.get as jest.Mock).mockReturnValue(null)

    const mockSetThreadStates = jest.fn()
    const mockSetThreads = jest.fn()
    const mockSetThreadModelRuntimeParams = jest.fn()
    const mockSetThreadDataReady = jest.fn()

    ;(useSetAtom as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case threadStatesAtom:
          return mockSetThreadStates
        case threadsAtom:
          return mockSetThreads
        case threadModelParamsAtom:
          return mockSetThreadModelRuntimeParams
        case threadDataReadyAtom:
          return mockSetThreadDataReady
        default:
          return jest.fn()
      }
    })

    const { result } = renderHook(() => useThreads())

    await act(async () => {
      // Wait for useEffect to complete
    })

    expect(mockSetThreadStates).toHaveBeenCalledWith({})
    expect(mockSetThreads).toHaveBeenCalledWith([])
    expect(mockSetThreadModelRuntimeParams).toHaveBeenCalledWith({})
    expect(mockSetThreadDataReady).toHaveBeenCalledWith(true)
  })
})
