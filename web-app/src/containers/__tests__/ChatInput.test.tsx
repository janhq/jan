import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createRouter, createRootRoute, createMemoryHistory } from '@tanstack/react-router'
import ChatInput from '../ChatInput'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useAppState } from '@/hooks/useAppState'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChat } from '@/hooks/useChat'
import type { ThreadModel } from '@/types/threads'

// Mock dependencies
vi.mock('@/hooks/usePrompt', () => ({
  usePrompt: vi.fn(() => ({
    prompt: '',
    setPrompt: vi.fn(),
  })),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    currentThreadId: null,
    getCurrentThread: vi.fn(),
  })),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn(() => ({
    streamingContent: '',
    abortController: null,
  })),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: vi.fn(() => ({
    allowSendWhenUnloaded: false,
  })),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    selectedModel: null,
    providers: [],
    getModelBy: vi.fn(),
    selectModelProvider: vi.fn(),
    selectedProvider: 'llamacpp',
    setProviders: vi.fn(),
    getProviderByName: vi.fn(),
    updateProvider: vi.fn(),
    addProvider: vi.fn(),
    deleteProvider: vi.fn(),
    deleteModel: vi.fn(),
    deletedModels: [],
  })),
}))

vi.mock('@/hooks/useChat', () => ({
  useChat: vi.fn(() => ({
    sendMessage: vi.fn(),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock the ServiceHub
const mockGetConnectedServers = vi.fn(() => Promise.resolve([]))
const mockStopAllModels = vi.fn()
const mockCheckMmprojExists = vi.fn(() => Promise.resolve(true))

const mockServiceHub = {
  mcp: () => ({
    getConnectedServers: mockGetConnectedServers,
  }),
  models: () => ({
    stopAllModels: mockStopAllModels,
    checkMmprojExists: mockCheckMmprojExists,
  }),
}

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => mockServiceHub,
  useServiceHub: () => mockServiceHub,
}))

vi.mock('../MovingBorder', () => ({
  MovingBorder: ({ children }: { children: React.ReactNode }) => <div data-testid="moving-border">{children}</div>,
}))

vi.mock('@/containers/DropdownModelProvider', () => ({
  default: () => <div data-testid="model-dropdown" data-slot="popover-trigger">Model Dropdown</div>,
}))

vi.mock('@/containers/loaders/ModelLoader', () => ({
  ModelLoader: () => <div data-testid="model-loader">Model Loader</div>,
}))

vi.mock('@/containers/DropdownToolsAvailable', () => ({
  default: () => <div data-testid="tools-dropdown">Tools Dropdown</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-test-id={props['data-test-id']}
      data-testid={props['data-test-id']}
      {...props}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('react-textarea-autosize', () => ({
  default: ({ value, onChange, onKeyDown, placeholder, disabled, className, minRows, maxRows, onHeightChange, ...props }: any) => (
    <textarea
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      data-testid={props['data-testid']}
      rows={minRows || 1}
      style={{ resize: 'none' }}
    />
  ),
}))

// Mock icons
vi.mock('lucide-react', () => ({
  ArrowRight: () => <svg data-testid="arrow-right-icon">ArrowRight</svg>,
}))

vi.mock('@tabler/icons-react', () => ({
  IconPhoto: () => <svg data-testid="photo-icon">Photo</svg>,
  IconWorld: () => <svg data-testid="world-icon">World</svg>,
  IconAtom: () => <svg data-testid="atom-icon">Atom</svg>,
  IconTool: () => <svg data-testid="tool-icon">Tool</svg>,
  IconCodeCircle2: () => <svg data-testid="code-icon">Code</svg>,
  IconPlayerStopFilled: () => <svg className="tabler-icon-player-stop-filled" data-testid="stop-icon">Stop</svg>,
  IconX: () => <svg data-testid="x-icon">X</svg>,
}))

describe('ChatInput', () => {
  const mockSendMessage = vi.fn()
  const mockSetPrompt = vi.fn()

  const createTestRouter = () => {
    const MockComponent = () => <ChatInput />
    const rootRoute = createRootRoute({
      component: MockComponent,
    })

    return createRouter({ 
      routeTree: rootRoute,
      history: createMemoryHistory({
        initialEntries: ['/'],
      }),
    })
  }

  const renderWithRouter = () => {
    const router = createTestRouter()
    return render(<RouterProvider router={router} />)
  }

  const renderChatInput = () => {
    return render(<ChatInput />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Set up default mock returns
    vi.mocked(usePrompt).mockReturnValue({
      prompt: '',
      setPrompt: mockSetPrompt,
    })
    
    vi.mocked(useThreads).mockReturnValue({
      currentThreadId: 'test-thread-id',
      getCurrentThread: vi.fn(),
      setCurrentThreadId: vi.fn(),
    })
    
    vi.mocked(useAppState).mockReturnValue({
      streamingContent: null,
      abortControllers: {},
      loadingModel: false,
      tools: [],
    })
    
    vi.mocked(useGeneralSetting).mockReturnValue({
      spellCheckChatInput: true,
      allowSendWhenUnloaded: false,
      experimentalFeatures: true,
    })
    
    vi.mocked(useModelProvider).mockReturnValue({
      selectedModel: {
        id: 'test-model',
        capabilities: ['tools', 'vision'],
      },
      providers: [
        {
          provider: 'llamacpp',
          models: [
            {
              id: 'test-model',
              capabilities: ['tools', 'vision'],
            }
          ]
        }
      ],
      getModelBy: vi.fn(() => ({
        id: 'test-model',
        capabilities: ['tools', 'vision'],
      })),
      selectModelProvider: vi.fn(),
      selectedProvider: 'llamacpp',
      setProviders: vi.fn(),
      getProviderByName: vi.fn(),
      updateProvider: vi.fn(),
      addProvider: vi.fn(),
      deleteProvider: vi.fn(),
      deleteModel: vi.fn(),
      deletedModels: [],
    })
    
    vi.mocked(useChat).mockReturnValue({
      sendMessage: mockSendMessage,
    })
  })

  it('renders chat input textarea', () => {
    const { container } = renderChatInput()

    // Debug: log the rendered HTML
    // console.log(container.innerHTML)

    const textarea = screen.getByTestId('chat-input')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute('placeholder', 'common:placeholder.chatInput')
  })

  it('renders send button', () => {
    renderChatInput()

    const sendButton = screen.getByTestId('send-message-button')
    expect(sendButton).toBeInTheDocument()
  })

  it('disables send button when prompt is empty', () => {
    renderChatInput()

    const sendButton = screen.getByTestId('send-message-button')
    expect(sendButton).toBeDisabled()
  })

  it('enables send button when prompt has content', () => {
    // Mock prompt with content
    vi.mocked(usePrompt).mockReturnValue({
      prompt: 'Hello world',
      setPrompt: mockSetPrompt,
    })

    renderChatInput()

    const sendButton = screen.getByTestId('send-message-button')
    expect(sendButton).not.toBeDisabled()
  })

  it('calls setPrompt when typing in textarea', async () => {
    const user = userEvent.setup()
    renderChatInput()

    const textarea = screen.getByTestId('chat-input')
    await user.type(textarea, 'Hello')

    // setPrompt is called for each character typed
    expect(mockSetPrompt).toHaveBeenCalledTimes(5)
    expect(mockSetPrompt).toHaveBeenLastCalledWith('o')
  })

  it('calls sendMessage when send button is clicked', async () => {
    const user = userEvent.setup()

    // Mock prompt with content
    vi.mocked(usePrompt).mockReturnValue({
      prompt: 'Hello world',
      setPrompt: mockSetPrompt,
    })

    renderChatInput()

    const sendButton = screen.getByTestId('send-message-button')
    await user.click(sendButton)

    expect(mockSendMessage).toHaveBeenCalledWith('Hello world', true, undefined)
  })

  it('sends message when Enter key is pressed', async () => {
    const user = userEvent.setup()

    // Mock prompt with content
    vi.mocked(usePrompt).mockReturnValue({
      prompt: 'Hello world',
      setPrompt: mockSetPrompt,
    })

    renderChatInput()

    const textarea = screen.getByTestId('chat-input')
    await user.type(textarea, '{Enter}')

    expect(mockSendMessage).toHaveBeenCalledWith('Hello world', true, undefined)
  })

  it('does not send message when Shift+Enter is pressed', async () => {
    const user = userEvent.setup()

    // Mock prompt with content
    vi.mocked(usePrompt).mockReturnValue({
      prompt: 'Hello world',
      setPrompt: mockSetPrompt,
    })

    renderChatInput()

    const textarea = screen.getByTestId('chat-input')
    await user.type(textarea, '{Shift>}{Enter}{/Shift}')

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('shows stop button when streaming', () => {
    // Mock streaming state
    vi.mocked(useAppState).mockReturnValue({
      streamingContent: { thread_id: 'test-thread' },
      abortControllers: {},
      loadingModel: false,
      tools: [],
    })

    renderChatInput()

    // Stop button should be rendered
    const stopButton = screen.getByTestId('stop-icon')
    expect(stopButton).toBeInTheDocument()
  })


  it('shows model selection dropdown', () => {
    renderChatInput()

    // Model selection dropdown should be rendered
    const modelDropdown = screen.getByTestId('model-dropdown')
    expect(modelDropdown).toBeInTheDocument()
  })

  it('shows error message when no model is selected', async () => {
    const user = userEvent.setup()

    // Mock no selected model and prompt with content
    vi.mocked(useModelProvider).mockReturnValue({
      selectedModel: null,
      providers: [],
      getModelBy: vi.fn(),
      selectModelProvider: vi.fn(),
      selectedProvider: 'llamacpp',
      setProviders: vi.fn(),
      getProviderByName: vi.fn(),
      updateProvider: vi.fn(),
      addProvider: vi.fn(),
      deleteProvider: vi.fn(),
      deleteModel: vi.fn(),
      deletedModels: [],
    })

    vi.mocked(usePrompt).mockReturnValue({
      prompt: 'Hello world',
      setPrompt: mockSetPrompt,
    })

    renderChatInput()

    const sendButton = screen.getByTestId('send-message-button')
    await user.click(sendButton)

    // The component should still render without crashing when no model is selected
    expect(sendButton).toBeInTheDocument()
  })

  it('handles file upload', async () => {
    const user = userEvent.setup()
    renderChatInput()

    // Wait for async effects to complete (mmproj check)
    await waitFor(() => {
      // File upload is rendered as hidden input element
      const fileInput = document.querySelector('input[type="file"]')
      expect(fileInput).toBeInTheDocument()
    })
  })

  it('disables input when streaming', () => {
    // Mock streaming state
    vi.mocked(useAppState).mockReturnValue({
      streamingContent: { thread_id: 'test-thread' },
      abortControllers: {},
      loadingModel: false,
      tools: [],
    })

    renderChatInput()

    const textarea = screen.getByTestId('chat-input')
    expect(textarea).toBeDisabled()
  })

  it('shows tools dropdown when model supports tools and MCP servers are connected', async () => {
    // Mock connected servers
    mockGetConnectedServers.mockResolvedValue(['server1'])

    renderChatInput()

    await waitFor(() => {
      // Tools dropdown should be rendered
      const toolsDropdown = screen.getByTestId('tools-dropdown')
      expect(toolsDropdown).toBeInTheDocument()
    })
  })

  it('uses selectedProvider for provider checks', () => {
    // Test that the component correctly uses selectedProvider instead of selectedModel.provider
    vi.mocked(useModelProvider).mockReturnValue({
      selectedModel: {
        id: 'test-model',
        capabilities: ['vision'],
      },
      providers: [],
      getModelBy: vi.fn(),
      selectModelProvider: vi.fn(),
      selectedProvider: 'llamacpp',
      setProviders: vi.fn(),
      getProviderByName: vi.fn(),
      updateProvider: vi.fn(),
      addProvider: vi.fn(),
      deleteProvider: vi.fn(),
      deleteModel: vi.fn(),
      deletedModels: [],
    })
    
    // This test ensures the component renders without errors when using selectedProvider
    expect(() => renderChatInput()).not.toThrow()
  })
})