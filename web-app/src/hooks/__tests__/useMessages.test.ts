import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessages } from '../useMessages'
import { ThreadMessage } from '@janhq/core'

// Mock the ServiceHub
const mockCreateMessage = vi.fn()
const mockDeleteMessage = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    messages: () => ({
      createMessage: mockCreateMessage,
      deleteMessage: mockDeleteMessage,
    }),
  }),
}))

vi.mock('./useAssistant', () => ({
  useAssistant: {
    getState: vi.fn(() => ({
      currentAssistant: {
        id: 'test-assistant',
        name: 'Test Assistant',
        avatar: 'test-avatar.png',
        instructions: 'Test instructions',
        parameters: 'test parameters',
      },
      assistants: [{
        id: 'test-assistant',
        name: 'Test Assistant',
        avatar: 'test-avatar.png',
        instructions: 'Test instructions',
        parameters: 'test parameters',
      }],
    })),
  },
}))

describe('useMessages', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    useMessages.setState({ messages: {} })
  })

  it('should initialize with empty messages', () => {
    const { result } = renderHook(() => useMessages())

    expect(result.current.messages).toEqual({})
  })

  describe('getMessages', () => {
    it('should return empty array for non-existent thread', () => {
      const { result } = renderHook(() => useMessages())

      const messages = result.current.getMessages('non-existent-thread')
      expect(messages).toEqual([])
    })

    it('should return messages for existing thread', () => {
      const { result } = renderHook(() => useMessages())

      const testMessages: ThreadMessage[] = [
        {
          id: 'msg1',
          thread_id: 'thread1',
          role: 'user',
          content: 'Hello',
          created_at: Date.now(),
        },
        {
          id: 'msg2',
          thread_id: 'thread1',
          role: 'assistant',
          content: 'Hi there!',
          created_at: Date.now(),
        },
      ]

      act(() => {
        result.current.setMessages('thread1', testMessages)
      })

      const messages = result.current.getMessages('thread1')
      expect(messages).toEqual(testMessages)
    })
  })

  describe('setMessages', () => {
    it('should set messages for a thread', () => {
      const { result } = renderHook(() => useMessages())

      const testMessages: ThreadMessage[] = [
        {
          id: 'msg1',
          thread_id: 'thread1',
          role: 'user',
          content: 'Hello',
          created_at: Date.now(),
        },
      ]

      act(() => {
        result.current.setMessages('thread1', testMessages)
      })

      expect(result.current.messages['thread1']).toEqual(testMessages)
    })

    it('should handle multiple threads', () => {
      const { result } = renderHook(() => useMessages())

      const thread1Messages: ThreadMessage[] = [
        {
          id: 'msg1',
          thread_id: 'thread1',
          role: 'user',
          content: 'Hello from thread 1',
          created_at: Date.now(),
        },
      ]

      const thread2Messages: ThreadMessage[] = [
        {
          id: 'msg2',
          thread_id: 'thread2',
          role: 'user',
          content: 'Hello from thread 2',
          created_at: Date.now(),
        },
      ]

      act(() => {
        result.current.setMessages('thread1', thread1Messages)
        result.current.setMessages('thread2', thread2Messages)
      })

      expect(result.current.messages['thread1']).toEqual(thread1Messages)
      expect(result.current.messages['thread2']).toEqual(thread2Messages)
    })

    it('should replace existing messages', () => {
      const { result } = renderHook(() => useMessages())

      const initialMessages: ThreadMessage[] = [
        {
          id: 'msg1',
          thread_id: 'thread1',
          role: 'user',
          content: 'Initial message',
          created_at: Date.now(),
        },
      ]

      const newMessages: ThreadMessage[] = [
        {
          id: 'msg2',
          thread_id: 'thread1',
          role: 'user',
          content: 'New message',
          created_at: Date.now(),
        },
      ]

      act(() => {
        result.current.setMessages('thread1', initialMessages)
      })

      expect(result.current.messages['thread1']).toEqual(initialMessages)

      act(() => {
        result.current.setMessages('thread1', newMessages)
      })

      expect(result.current.messages['thread1']).toEqual(newMessages)
    })
  })

  describe('addMessage', () => {
    it('should add message and call createMessage service', async () => {
      const { result } = renderHook(() => useMessages())

      const mockCreatedMessage: ThreadMessage = {
        id: 'created-msg',
        thread_id: 'thread1',
        role: 'user',
        content: 'Test message',
        created_at: Date.now(),
        metadata: {
          assistant: {
            id: 'test-assistant',
            name: 'Test Assistant',
            avatar: 'test-avatar.png',
            instructions: 'Test instructions',
            parameters: 'test parameters',
          },
        },
      }

      mockCreateMessage.mockResolvedValue(mockCreatedMessage)

      const messageToAdd: ThreadMessage = {
        id: 'temp-msg',
        thread_id: 'thread1',
        role: 'user',
        content: 'Test message',
        created_at: Date.now(),
      }

      act(() => {
        result.current.addMessage(messageToAdd)
      })

      expect(mockCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ...messageToAdd,
          metadata: expect.objectContaining({
            assistant: expect.objectContaining({
              id: expect.any(String),
              name: expect.any(String),
            }),
          }),
        })
      )

      // Message should be immediately available (optimistic update)
      expect(result.current.messages['thread1']).toContainEqual(
        expect.objectContaining({
          id: messageToAdd.id,
          thread_id: messageToAdd.thread_id,
          role: messageToAdd.role,
          content: messageToAdd.content,
          metadata: expect.objectContaining({
            assistant: expect.objectContaining({
              id: expect.any(String),
              name: expect.any(String),
            }),
          }),
        })
      )

      // Verify persistence was attempted
      await vi.waitFor(() => {
        expect(mockCreateMessage).toHaveBeenCalled()
      })
    })

    it('should handle message without created_at', async () => {
      const { result } = renderHook(() => useMessages())

      const mockCreatedMessage: ThreadMessage = {
        id: 'created-msg',
        thread_id: 'thread1',
        role: 'user',
        content: 'Test message',
        created_at: Date.now(),
      }

      mockCreateMessage.mockResolvedValue(mockCreatedMessage)

      const messageToAdd: ThreadMessage = {
        id: 'temp-msg',
        thread_id: 'thread1',
        role: 'user',
        content: 'Test message',
        // no created_at provided
      } as ThreadMessage

      act(() => {
        result.current.addMessage(messageToAdd)
      })

      expect(mockCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          created_at: expect.any(Number),
        })
      )
    })

    it('should preserve existing metadata', async () => {
      const { result } = renderHook(() => useMessages())

      const mockCreatedMessage: ThreadMessage = {
        id: 'created-msg',
        thread_id: 'thread1',
        role: 'user',
        content: 'Test message',
        created_at: Date.now(),
      }

      mockCreateMessage.mockResolvedValue(mockCreatedMessage)

      const messageToAdd: ThreadMessage = {
        id: 'temp-msg',
        thread_id: 'thread1',
        role: 'user',
        content: 'Test message',
        created_at: Date.now(),
        metadata: {
          customField: 'custom value',
        },
      }

      act(() => {
        result.current.addMessage(messageToAdd)
      })

      expect(mockCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            customField: 'custom value',
            assistant: expect.any(Object),
          }),
        })
      )
    })
  })

  describe('deleteMessage', () => {
    it('should delete message and call deleteMessage service', () => {
      const { result } = renderHook(() => useMessages())

      const testMessages: ThreadMessage[] = [
        {
          id: 'msg1',
          thread_id: 'thread1',
          role: 'user',
          content: 'Message 1',
          created_at: Date.now(),
        },
        {
          id: 'msg2',
          thread_id: 'thread1',
          role: 'user',
          content: 'Message 2',
          created_at: Date.now(),
        },
      ]

      act(() => {
        result.current.setMessages('thread1', testMessages)
      })

      act(() => {
        result.current.deleteMessage('thread1', 'msg1')
      })

      expect(mockDeleteMessage).toHaveBeenCalledWith('thread1', 'msg1')
      expect(result.current.messages['thread1']).toEqual([testMessages[1]])
    })

    it('should handle deleting from empty thread', () => {
      const { result } = renderHook(() => useMessages())

      act(() => {
        result.current.deleteMessage('empty-thread', 'non-existent-msg')
      })

      expect(mockDeleteMessage).toHaveBeenCalledWith('empty-thread', 'non-existent-msg')
      expect(result.current.messages['empty-thread']).toEqual([])
    })

    it('should handle deleting non-existent message', () => {
      const { result } = renderHook(() => useMessages())

      const testMessages: ThreadMessage[] = [
        {
          id: 'msg1',
          thread_id: 'thread1',
          role: 'user',
          content: 'Message 1',
          created_at: Date.now(),
        },
      ]

      act(() => {
        result.current.setMessages('thread1', testMessages)
      })

      act(() => {
        result.current.deleteMessage('thread1', 'non-existent-msg')
      })

      expect(mockDeleteMessage).toHaveBeenCalledWith('thread1', 'non-existent-msg')
      expect(result.current.messages['thread1']).toEqual(testMessages)
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useMessages())
      const { result: result2 } = renderHook(() => useMessages())

      const testMessage: ThreadMessage = {
        id: 'msg1',
        thread_id: 'thread1',
        role: 'user',
        content: 'Test message',
        created_at: Date.now(),
      }

      act(() => {
        result1.current.setMessages('thread1', [testMessage])
      })

      expect(result2.current.getMessages('thread1')).toEqual([testMessage])
    })
  })
})
