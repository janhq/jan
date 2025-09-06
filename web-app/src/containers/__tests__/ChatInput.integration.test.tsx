import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createMemoryHistory,
} from '@tanstack/react-router'
import ChatInput from '../ChatInput'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useAppState } from '@/hooks/useAppState'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'

/**
 * Integration tests for ChatInput with Scheduler System
 *
 * Tests the complete integration between ChatInput and the inference scheduler:
 * - Messages always go through the queue system
 * - Scheduler handles message processing
 * - UI state updates correctly
 * - No direct sendMessage calls from UI
 */

// Mock all dependencies
const mockAddToThreadQueue = vi.fn()
const mockGetThreadQueueLength = vi.fn(() => 0)
const mockSetPrompt = vi.fn()

vi.mock('@/hooks/usePrompt', () => ({
  usePrompt: vi.fn(() => ({
    prompt: '',
    setPrompt: mockSetPrompt,
  })),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    currentThreadId: 'test-thread-id',
  })),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn((selector) => {
    const mockState = {
      streamingContent: null,
      abortControllers: {},
      loadingModel: false,
      tools: [],
      addToThreadQueue: mockAddToThreadQueue,
      getThreadQueueLength: mockGetThreadQueueLength,
    }
    return selector ? selector(mockState) : mockState
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: vi.fn(() => ({
    spellCheckChatInput: false,
    experimentalFeatures: false,
  })),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    selectedModel: {
      id: 'test-model',
      name: 'Test Model',
      provider: 'test-provider',
      capabilities: [],
    },
  })),
}))

// Mock MCP services
vi.mock('@/services/mcp', () => ({
  getConnectedServers: vi.fn().mockResolvedValue([]),
}))

// Mock translation
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock components
vi.mock('@/containers/DropdownModelProvider', () => ({
  default: () => <div data-testid="model-provider">Model Provider</div>,
}))

vi.mock('@/containers/loaders/ModelLoader', () => ({
  ModelLoader: () => <div data-testid="model-loader">Loading...</div>,
}))

vi.mock('@/containers/DropdownToolsAvailable', () => ({
  default: ({ children }: { children: (isOpen: boolean, toolsCount: number) => React.ReactNode }) => (
    <div data-testid="tools-dropdown">{children(false, 0)}</div>
  ),
}))

vi.mock('../MovingBorder', () => ({
  MovingBorder: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="moving-border">{children}</div>
  ),
}))

describe('ChatInput Integration with Scheduler', () => {
  const renderChatInput = () => {
    const rootRoute = createRootRoute({
      component: () => <ChatInput />,
    })

    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    return render(<RouterProvider router={router} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock implementations
    mockAddToThreadQueue.mockClear()
    mockGetThreadQueueLength.mockClear()
    mockSetPrompt.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Message Queue Integration', () => {
    it('should queue messages on Enter keypress instead of sending directly', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message for queue'

      // Mock the prompt value
      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.type(textarea, mockPrompt)
      await user.keyboard('{Enter}')

      // Verify message was queued
      expect(mockAddToThreadQueue).toHaveBeenCalledWith('test-thread-id', mockPrompt)
      // Verify prompt was cleared
      expect(mockSetPrompt).toHaveBeenCalledWith('')
    })

    it('should queue messages on send button click instead of sending directly', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message for send button'

      // Mock the prompt value
      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const sendButton = screen.getByTestId('send-message-button')
      await user.click(sendButton)

      // Verify message was queued
      expect(mockAddToThreadQueue).toHaveBeenCalledWith('test-thread-id', mockPrompt)
      // Verify prompt was cleared
      expect(mockSetPrompt).toHaveBeenCalledWith('')
    })

    it('should not queue empty messages', async () => {
      const user = userEvent.setup()

      // Mock empty prompt
      vi.mocked(usePrompt).mockReturnValue({
        prompt: '   ', // whitespace only
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Enter}')

      // Verify message was NOT queued
      expect(mockAddToThreadQueue).not.toHaveBeenCalled()
      expect(mockSetPrompt).not.toHaveBeenCalled()
    })

    it('should handle missing currentThreadId gracefully', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message'

      // Mock no current thread
      vi.mocked(useThreads).mockReturnValue({
        currentThreadId: null,
      })

      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const sendButton = screen.getByTestId('send-message-button')
      await user.click(sendButton)

      // Verify message was NOT queued
      expect(mockAddToThreadQueue).not.toHaveBeenCalled()
    })
  })

  describe('Queue Status Display', () => {
    it('should show queue indicator when messages are queued', () => {
      // Mock queue with messages
      mockGetThreadQueueLength.mockReturnValue(3)

      renderChatInput()

      expect(screen.getByText('3 messages queued')).toBeInTheDocument()
    })

    it('should handle singular queue message correctly', () => {
      // Mock queue with single message
      mockGetThreadQueueLength.mockReturnValue(1)

      renderChatInput()

      expect(screen.getByText('1 message queued')).toBeInTheDocument()
    })

    it('should not show queue indicator when no messages queued', () => {
      // Mock empty queue
      mockGetThreadQueueLength.mockReturnValue(0)

      renderChatInput()

      expect(screen.queryByText(/queued/)).not.toBeInTheDocument()
    })
  })

  describe('Model Selection Integration', () => {
    it('should prevent queuing when no model is selected', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message'

      // Mock no selected model
      vi.mocked(useModelProvider).mockReturnValue({
        selectedModel: null,
      })

      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const sendButton = screen.getByTestId('send-message-button')
      await user.click(sendButton)

      // Verify message was NOT queued
      expect(mockAddToThreadQueue).not.toHaveBeenCalled()
    })

    it('should allow queuing when model is selected', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message'

      // Mock selected model
      vi.mocked(useModelProvider).mockReturnValue({
        selectedModel: {
          id: 'test-model',
          name: 'Test Model',
          provider: 'test-provider',
          capabilities: [],
        },
      })

      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const sendButton = screen.getByTestId('send-message-button')
      await user.click(sendButton)

      // Verify message was queued
      expect(mockAddToThreadQueue).toHaveBeenCalledWith('test-thread-id', mockPrompt)
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('should allow newlines with Shift+Enter', async () => {
      const user = userEvent.setup()

      vi.mocked(usePrompt).mockReturnValue({
        prompt: 'Test message',
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Shift>}{Enter}{/Shift}')

      // Verify message was NOT queued (shift+enter should create newline)
      expect(mockAddToThreadQueue).not.toHaveBeenCalled()
    })

    it('should queue message with Enter (no shift)', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message'

      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)
      await user.keyboard('{Enter}')

      // Verify message was queued
      expect(mockAddToThreadQueue).toHaveBeenCalledWith('test-thread-id', mockPrompt)
    })
  })

  describe('Thread Switching Scenarios', () => {
    it('should queue messages to the correct thread after thread switch', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message for new thread'

      // Mock thread switch
      vi.mocked(useThreads).mockReturnValue({
        currentThreadId: 'new-thread-id',
      })

      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const sendButton = screen.getByTestId('send-message-button')
      await user.click(sendButton)

      // Verify message was queued to correct thread
      expect(mockAddToThreadQueue).toHaveBeenCalledWith('new-thread-id', mockPrompt)
    })

    it('should update queue indicator for current thread', () => {
      const currentThreadId = 'active-thread'
      
      // Mock current thread with queue
      vi.mocked(useThreads).mockReturnValue({
        currentThreadId,
      })

      // Mock queue state for specific thread
      vi.mocked(useAppState).mockImplementation((selector) => {
        const mockState = {
          streamingContent: null,
          abortControllers: {},
          loadingModel: false,
          tools: [],
          addToThreadQueue: mockAddToThreadQueue,
          getThreadQueueLength: (threadId: string) => {
            return threadId === currentThreadId ? 2 : 0
          },
        }
        return selector ? selector(mockState) : mockState
      })

      renderChatInput()

      expect(screen.getByText('2 messages queued')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle IME composition correctly', async () => {
      const user = userEvent.setup()
      const mockPrompt = 'Test message'

      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const textarea = screen.getByTestId('chat-input')
      await user.click(textarea)

      // Simulate IME composition (e.g., typing in Asian languages)
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        keyCode: 229, // IME composition keyCode
      })

      // Verify message was NOT queued during composition
      expect(mockAddToThreadQueue).not.toHaveBeenCalled()
    })

    it('should trim whitespace from messages before queuing', async () => {
      const user = userEvent.setup()
      const mockPrompt = '  Test message with whitespace  '

      vi.mocked(usePrompt).mockReturnValue({
        prompt: mockPrompt,
        setPrompt: mockSetPrompt,
      })

      renderChatInput()

      const sendButton = screen.getByTestId('send-message-button')
      await user.click(sendButton)

      // Verify message was trimmed before queuing
      expect(mockAddToThreadQueue).toHaveBeenCalledWith('test-thread-id', 'Test message with whitespace')
    })
  })
})
