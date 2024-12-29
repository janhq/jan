/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import useDeleteThread from './useDeleteThread'
import { extensionManager } from '@/extension/ExtensionManager'
import { useCreateNewThread } from './useCreateNewThread'
// Mock the necessary dependencies
// Mock dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))
jest.mock('./useCreateNewThread')
jest.mock('@/extension/ExtensionManager')
jest.mock('@/containers/Toast')

describe('useDeleteThread', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should delete a thread successfully', async () => {
    const mockThreads = [
      { id: 'thread1', title: 'Thread 1' },
      { id: 'thread2', title: 'Thread 2' },
    ]
    const mockSetThreads = jest.fn()
    ;(useAtom as jest.Mock).mockReturnValue([mockThreads, mockSetThreads])
    ;(useSetAtom as jest.Mock).mockReturnValue(() => {})
    ;(useCreateNewThread as jest.Mock).mockReturnValue({})

    const mockDeleteThread = jest.fn().mockImplementation(() => ({
      catch: () => jest.fn,
    }))

    extensionManager.get = jest.fn().mockReturnValue({
      deleteThread: mockDeleteThread,
    })

    const { result } = renderHook(() => useDeleteThread())

    await act(async () => {
      await result.current.deleteThread('thread1')
    })

    expect(mockDeleteThread).toHaveBeenCalledWith('thread1')
    expect(mockSetThreads).toHaveBeenCalledWith([mockThreads[1]])
  })

  it('should clean a thread successfully', async () => {
    const mockThreads = [{ id: 'thread1', title: 'Thread 1', metadata: {} }]
    const mockSetThreads = jest.fn()
    ;(useAtom as jest.Mock).mockReturnValue([mockThreads, mockSetThreads])
    const mockCleanMessages = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(() => mockCleanMessages)
    ;(useAtomValue as jest.Mock).mockReturnValue(['thread 1'])

    const mockSaveThread = jest.fn()
    const mockDeleteMessage = jest.fn().mockResolvedValue({})
    const mockModifyThread = jest.fn().mockResolvedValue({})
    extensionManager.get = jest.fn().mockReturnValue({
      saveThread: mockSaveThread,
      getThreadAssistant: jest.fn().mockResolvedValue({}),
      listMessages: jest.fn().mockResolvedValue([
        {
          id: 'message1',
          text: 'Message 1',
        },
      ]),
      deleteMessage: mockDeleteMessage,
      modifyThread: mockModifyThread,
    })

    const { result } = renderHook(() => useDeleteThread())

    await act(async () => {
      await result.current.cleanThread('thread1')
    })

    expect(mockDeleteMessage).toHaveBeenCalled()
    expect(mockModifyThread).toHaveBeenCalled()
  })

  it('should handle errors when deleting a thread', async () => {
    const mockThreads = [{ id: 'thread1', title: 'Thread 1' }]
    const mockSetThreads = jest.fn()
    ;(useAtom as jest.Mock).mockReturnValue([mockThreads, mockSetThreads])
    const mockCreateNewThread = jest.fn()
    ;(useCreateNewThread as jest.Mock).mockReturnValue({
      requestCreateNewThread: mockCreateNewThread,
    })

    const mockDeleteThread = jest
      .fn()
      .mockRejectedValue(new Error('Delete error'))
    extensionManager.get = jest.fn().mockReturnValue({
      deleteThread: mockDeleteThread,
    })

    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    const { result } = renderHook(() => useDeleteThread())

    await act(async () => {
      await result.current.deleteThread('thread1')
    })

    expect(mockDeleteThread).toHaveBeenCalledWith('thread1')
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error))

    consoleErrorSpy.mockRestore()
  })
})
