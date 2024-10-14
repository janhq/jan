import { renderHook, act } from '@testing-library/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import useDeleteThread from './useDeleteThread'
import { extensionManager } from '@/extension/ExtensionManager'
import { toaster } from '@/containers/Toast'

// Mock the necessary dependencies
// Mock dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))
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

    const mockDeleteThread = jest.fn()
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

    const mockWriteMessages = jest.fn()
    const mockSaveThread = jest.fn()
    extensionManager.get = jest.fn().mockReturnValue({
      writeMessages: mockWriteMessages,
      saveThread: mockSaveThread,
    })

    const { result } = renderHook(() => useDeleteThread())

    await act(async () => {
      await result.current.cleanThread('thread1')
    })

    expect(mockWriteMessages).toHaveBeenCalled()
    expect(mockSaveThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'thread1',
        title: 'New Thread',
        metadata: expect.objectContaining({ lastMessage: undefined }),
      })
    )
  })

  it('should handle errors when deleting a thread', async () => {
    const mockThreads = [{ id: 'thread1', title: 'Thread 1' }]
    const mockSetThreads = jest.fn()
    ;(useAtom as jest.Mock).mockReturnValue([mockThreads, mockSetThreads])

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
    expect(mockSetThreads).not.toHaveBeenCalled()
    expect(toaster).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})