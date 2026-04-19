import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessages } from '../useMessages'
import { ThreadMessage } from '@janhq/core'

const mockCreateMessage = vi.fn()
const mockModifyMessage = vi.fn()
const mockDeleteMessage = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    messages: () => ({
      createMessage: mockCreateMessage,
      modifyMessage: mockModifyMessage,
      deleteMessage: mockDeleteMessage,
    }),
  }),
}))

describe('useMessages - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMessages.setState({ messages: {} })
  })

  it('should clear all messages', () => {
    const { result } = renderHook(() => useMessages())

    act(() => {
      result.current.setMessages('t1', [{ id: 'm1', thread_id: 't1', role: 'user', content: 'hi', created_at: 1 }])
      result.current.setMessages('t2', [{ id: 'm2', thread_id: 't2', role: 'user', content: 'yo', created_at: 2 }])
    })

    expect(Object.keys(result.current.messages)).toHaveLength(2)

    act(() => {
      result.current.clearAllMessages()
    })

    expect(result.current.messages).toEqual({})
  })

  it('should update message optimistically and persist', async () => {
    mockModifyMessage.mockResolvedValue(undefined)

    const { result } = renderHook(() => useMessages())
    const msg: ThreadMessage = { id: 'm1', thread_id: 't1', role: 'user', content: 'original', created_at: 1 }

    act(() => {
      result.current.setMessages('t1', [msg])
    })

    const updated: ThreadMessage = { ...msg, content: 'updated' }

    act(() => {
      result.current.updateMessage(updated)
    })

    expect(result.current.messages['t1'][0].content).toBe('updated')
    expect(mockModifyMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'updated' }))
  })

  it('should handle updateMessage error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockModifyMessage.mockRejectedValue(new Error('persist failed'))

    const { result } = renderHook(() => useMessages())
    const msg: ThreadMessage = { id: 'm1', thread_id: 't1', role: 'user', content: 'hi', created_at: 1 }

    act(() => {
      result.current.setMessages('t1', [msg])
    })

    act(() => {
      result.current.updateMessage({ ...msg, content: 'changed' })
    })

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to persist message update:', expect.any(Error))
    })
    consoleSpy.mockRestore()
  })

  it('should handle addMessage persistence error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateMessage.mockRejectedValue(new Error('create failed'))

    const { result } = renderHook(() => useMessages())

    act(() => {
      result.current.addMessage({ id: 'm1', thread_id: 't1', role: 'user', content: 'hi', created_at: 1 })
    })

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to persist message:', expect.any(Error))
    })
    consoleSpy.mockRestore()
  })

  it('should update message in empty thread gracefully', () => {
    const { result } = renderHook(() => useMessages())
    mockModifyMessage.mockResolvedValue(undefined)

    act(() => {
      result.current.updateMessage({ id: 'm1', thread_id: 't1', role: 'user', content: 'hi', created_at: 1 })
    })

    // Should create an empty array mapped
    expect(result.current.messages['t1']).toEqual([])
  })
})
