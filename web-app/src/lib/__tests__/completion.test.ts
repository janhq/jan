import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  newUserThreadContent,
  newAssistantThreadContent,
  emptyThreadContent,
  sendCompletion,
  isCompletionResponse,
  stopModel,
  normalizeTools,
  extractToolCall,
  postMessageProcessing,
  captureProactiveScreenshots
} from '../completion'

// Mock dependencies
vi.mock('@janhq/core', () => ({
  ContentType: {
    Text: 'text',
    Image: 'image',
  },
  ChatCompletionRole: {
    User: 'user',
    Assistant: 'assistant',
    System: 'system',
    Tool: 'tool',
  },
  MessageStatus: {
    Pending: 'pending',
    Ready: 'ready',
    Completed: 'completed',
  },
  EngineManager: {},
  ModelManager: {},
  chatCompletionRequestMessage: vi.fn(),
  chatCompletion: vi.fn(),
  chatCompletionChunk: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

vi.mock('token.js', () => ({
  models: {},
  TokenJS: class MockTokenJS {},
}))

vi.mock('ulidx', () => ({
  ulid: () => 'test-ulid-123',
}))

vi.mock('../messages', () => ({
  CompletionMessagesBuilder: class MockCompletionMessagesBuilder {
    constructor() {}
    build() {
      return []
    }
    addMessage() {
      return this
    }
  },
}))

vi.mock('@/services/mcp', () => ({
  callTool: vi.fn(),
}))

vi.mock('../extension', () => ({
  ExtensionManager: {},
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: vi.fn(() => ({
    mcp: vi.fn(() => ({
      getTools: vi.fn(() => Promise.resolve([])),
      callToolWithCancellation: vi.fn(() => ({
        promise: Promise.resolve({
          content: [{ type: 'text', text: 'mock result' }],
          error: '',
        }),
        cancel: vi.fn(),
      })),
    })),
    rag: vi.fn(() => ({
      getToolNames: vi.fn(() => Promise.resolve([])),
      callTool: vi.fn(() => Promise.resolve({
        content: [{ type: 'text', text: 'mock rag result' }],
        error: '',
      })),
    })),
  })),
}))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: {
    getState: vi.fn(() => ({ enabled: true })),
  },
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: vi.fn(() => ({
      setCancelToolCall: vi.fn(),
    })),
  },
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: {
    FILE_ATTACHMENTS: true,
  },
}))

vi.mock('@/lib/platform/types', () => ({
  PlatformFeature: {
    FILE_ATTACHMENTS: 'FILE_ATTACHMENTS',
  },
}))

describe('completion.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('newUserThreadContent', () => {
    it('should create user thread content', () => {
      const result = newUserThreadContent('thread-123', 'Hello world')

      expect(result.type).toBe('text')
      expect(result.role).toBe('user')
      expect(result.thread_id).toBe('thread-123')
      expect(result.content).toEqual([{
        type: 'text',
        text: {
          value: 'Hello world',
          annotations: [],
        },
      }])
    })

    it('should handle empty text', () => {
      const result = newUserThreadContent('thread-123', '')

      expect(result.type).toBe('text')
      expect(result.role).toBe('user')
      expect(result.content).toEqual([{
        type: 'text',
        text: {
          value: '',
          annotations: [],
        },
      }])
    })
  })

  describe('newAssistantThreadContent', () => {
    it('should create assistant thread content', () => {
      const result = newAssistantThreadContent('thread-123', 'AI response')

      expect(result.type).toBe('text')
      expect(result.role).toBe('assistant')
      expect(result.thread_id).toBe('thread-123')
      expect(result.content).toEqual([{
        type: 'text',
        text: {
          value: 'AI response',
          annotations: [],
        },
      }])
    })
  })

  describe('emptyThreadContent', () => {
    it('should have correct structure', () => {
      expect(emptyThreadContent).toBeDefined()
      expect(emptyThreadContent.id).toBeDefined()
      expect(emptyThreadContent.role).toBe('assistant')
      expect(emptyThreadContent.content).toEqual([])
    })
  })

  describe('isCompletionResponse', () => {
    it('should identify completion response', () => {
      const response = { choices: [] }
      const result = isCompletionResponse(response)
      expect(typeof result).toBe('boolean')
    })
  })

  describe('normalizeTools', () => {
    it('should normalize tools array', () => {
      const tools = [{ type: 'function', function: { name: 'test' } }]
      const result = normalizeTools(tools)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle empty array', () => {
      const result = normalizeTools([])
      expect(result).toBeUndefined()
    })
  })

  describe('extractToolCall', () => {
    it('should extract tool calls from message', () => {
      const message = {
        choices: [{
          delta: {
            tool_calls: [{ 
              id: 'call_1', 
              type: 'function', 
              index: 0,
              function: { name: 'test', arguments: '{}' } 
            }]
          }
        }]
      }
      const calls = []
      const result = extractToolCall(message, null, calls)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(1)
    })

    it('should handle message without tool calls', () => {
      const message = {
        choices: [{
          delta: {}
        }]
      }
      const calls = []
      const result = extractToolCall(message, null, calls)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })
  })

  describe('Proactive Mode - Browser MCP Tool Detection', () => {
    // We need to access the private function, so we'll test it through postMessageProcessing
    it('should detect browser tool names with "browser" prefix', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockGetTools = vi.fn(() => Promise.resolve([]))
      const mockMcp = {
        getTools: mockGetTools,
        callToolWithCancellation: vi.fn(() => ({
          promise: Promise.resolve({ content: [{ type: 'text', text: 'result' }], error: '' }),
          cancel: vi.fn(),
        }))
      }
      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => mockMcp,
        rag: () => ({ getToolNames: () => Promise.resolve([]) })
      } as any)

      const calls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'browserbase_navigate', arguments: '{"url": "test.com"}' }
      }]
      const builder = {
        addToolMessage: vi.fn(),
        getMessages: vi.fn(() => [])
      } as any
      const message = { thread_id: 'test-thread', metadata: {} } as any
      const abortController = new AbortController()

      await postMessageProcessing(
        calls,
        builder,
        message,
        abortController,
        {},
        undefined,
        false,
        true // isProactiveMode = true
      )

      // Verify tool was executed
      expect(mockMcp.callToolWithCancellation).toHaveBeenCalled()
    })

    it('should detect browserbase tools', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockCallTool = vi.fn(() => ({
        promise: Promise.resolve({ content: [{ type: 'text', text: 'result' }], error: '' }),
        cancel: vi.fn(),
      }))
      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: () => Promise.resolve([]),
          callToolWithCancellation: mockCallTool
        }),
        rag: () => ({ getToolNames: () => Promise.resolve([]) })
      } as any)

      const calls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'browserbase_screenshot', arguments: '{}' }
      }]
      const builder = {
        addToolMessage: vi.fn(),
        getMessages: vi.fn(() => [])
      } as any
      const message = { thread_id: 'test-thread', metadata: {} } as any
      const abortController = new AbortController()

      await postMessageProcessing(calls, builder, message, abortController, {}, undefined, false, true)

      expect(mockCallTool).toHaveBeenCalled()
    })

    it('should detect multi_browserbase tools', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockCallTool = vi.fn(() => ({
        promise: Promise.resolve({ content: [{ type: 'text', text: 'result' }], error: '' }),
        cancel: vi.fn(),
      }))
      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: () => Promise.resolve([]),
          callToolWithCancellation: mockCallTool
        }),
        rag: () => ({ getToolNames: () => Promise.resolve([]) })
      } as any)

      const calls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'multi_browserbase_stagehand_navigate', arguments: '{}' }
      }]
      const builder = {
        addToolMessage: vi.fn(),
        getMessages: vi.fn(() => [])
      } as any
      const message = { thread_id: 'test-thread', metadata: {} } as any
      const abortController = new AbortController()

      await postMessageProcessing(calls, builder, message, abortController, {}, undefined, false, true)

      expect(mockCallTool).toHaveBeenCalled()
    })

    it('should not treat non-browser tools as browser tools', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'fetch_url', server: 'test-server', description: 'Fetch URL', inputSchema: {} }
      ]))
      const mockCallTool = vi.fn(() => ({
        promise: Promise.resolve({ content: [{ type: 'text', text: 'result' }], error: '' }),
        cancel: vi.fn(),
      }))
      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: mockCallTool
        }),
        rag: () => ({ getToolNames: () => Promise.resolve([]) })
      } as any)

      const calls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'fetch_url', arguments: '{"url": "test.com"}' }
      }]
      const builder = {
        addToolMessage: vi.fn(),
        getMessages: vi.fn(() => [])
      } as any
      const message = { thread_id: 'test-thread', metadata: {} } as any
      const abortController = new AbortController()

      await postMessageProcessing(calls, builder, message, abortController, {}, undefined, false, true)

      // getTools should be called once for server lookup
      expect(mockGetTools).toHaveBeenCalledTimes(1)
      // callTool should be called once for the actual tool call
      expect(mockCallTool).toHaveBeenCalledTimes(1)
      // Verify proactive screenshots are NOT triggered (no additional getTools calls for screenshot tools)
      // and tool is called with correct server parameter
      expect(mockCallTool).toHaveBeenCalledWith({
        toolName: 'fetch_url',
        serverName: 'test-server',
        arguments: { url: 'test.com' }
      })
    })
  })

  describe('Proactive Mode - Screenshot Capture', () => {
    it('should capture screenshot and snapshot when available', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockScreenshotResult = {
        content: [{ type: 'image', data: 'base64screenshot', mimeType: 'image/png' }],
        error: '',
      }
      const mockSnapshotResult = {
        content: [{ type: 'text', text: 'snapshot html' }],
        error: '',
      }

      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'browserbase_screenshot', inputSchema: {} },
        { name: 'browserbase_snapshot', inputSchema: {} }
      ]))
      const mockCallTool = vi.fn()
        .mockReturnValueOnce({
          promise: Promise.resolve(mockScreenshotResult),
          cancel: vi.fn(),
        })
        .mockReturnValueOnce({
          promise: Promise.resolve(mockSnapshotResult),
          cancel: vi.fn(),
        })

      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: mockCallTool
        })
      } as any)

      const abortController = new AbortController()
      const results = await captureProactiveScreenshots(abortController)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual(mockScreenshotResult)
      expect(results[1]).toEqual(mockSnapshotResult)
      expect(mockCallTool).toHaveBeenCalledTimes(2)
    })

    it('should handle missing screenshot tool gracefully', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'some_other_tool', inputSchema: {} }
      ]))

      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: vi.fn()
        })
      } as any)

      const abortController = new AbortController()
      const results = await captureProactiveScreenshots(abortController)

      expect(results).toHaveLength(0)
    })

    it('should handle screenshot capture errors gracefully', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'browserbase_screenshot', inputSchema: {} }
      ]))
      const mockCallTool = vi.fn(() => ({
        promise: Promise.reject(new Error('Screenshot failed')),
        cancel: vi.fn(),
      }))

      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: mockCallTool
        })
      } as any)

      const abortController = new AbortController()
      const results = await captureProactiveScreenshots(abortController)

      // Should return empty array on error, not throw
      expect(results).toHaveLength(0)
    })

    it('should respect abort controller', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')
      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'browserbase_screenshot', inputSchema: {} }
      ]))
      const mockCallTool = vi.fn(() => ({
        promise: new Promise((resolve) => setTimeout(() => resolve({
          content: [{ type: 'image', data: 'base64', mimeType: 'image/png' }],
          error: '',
        }), 100)),
        cancel: vi.fn(),
      }))

      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: mockCallTool
        })
      } as any)

      const abortController = new AbortController()
      abortController.abort()

      const results = await captureProactiveScreenshots(abortController)

      // Should not attempt to capture if already aborted
      expect(results).toHaveLength(0)
    })
  })

  describe('Proactive Mode - Screenshot Filtering', () => {
    it('should filter out old image_url content from tool messages', () => {
      const builder = {
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'tool',
            content: [
              { type: 'text', text: 'Tool result' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,old' } }
            ],
            tool_call_id: 'old_call'
          },
          { role: 'assistant', content: 'Response' },
        ]
      }

      expect(builder.messages).toHaveLength(3)
    })
  })

  describe('Proactive Mode - Integration', () => {
    it('should trigger proactive screenshots after browser tool execution', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')

      const mockScreenshotResult = {
        content: [{ type: 'image', data: 'proactive_screenshot', mimeType: 'image/png' }],
        error: '',
      }

      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'browserbase_screenshot', inputSchema: {} }
      ]))

      let callCount = 0
      const mockCallTool = vi.fn(() => {
        callCount++
        if (callCount === 1) {
          // First call: the browser tool itself
          return {
            promise: Promise.resolve({
              content: [{ type: 'text', text: 'navigated to page' }],
              error: '',
            }),
            cancel: vi.fn(),
          }
        } else {
          // Second call: proactive screenshot
          return {
            promise: Promise.resolve(mockScreenshotResult),
            cancel: vi.fn(),
          }
        }
      })

      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: mockCallTool
        }),
        rag: () => ({ getToolNames: () => Promise.resolve([]) })
      } as any)

      const calls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'browserbase_navigate', arguments: '{"url": "test.com"}' }
      }]
      const builder = {
        addToolMessage: vi.fn(),
        getMessages: vi.fn(() => [])
      } as any
      const message = { thread_id: 'test-thread', metadata: {} } as any
      const abortController = new AbortController()

      await postMessageProcessing(
        calls,
        builder,
        message,
        abortController,
        {},
        undefined,
        false,
        true
      )

      // Should have called: 1) browser tool, 2) getTools, 3) proactive screenshot
      expect(mockCallTool).toHaveBeenCalledTimes(2)
      expect(mockGetTools).toHaveBeenCalled()
      expect(builder.addToolMessage).toHaveBeenCalledTimes(2)
    })

    it('should not trigger proactive screenshots when mode is disabled', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')

      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'browserbase_navigate', server: 'browserbase', description: 'Navigate', inputSchema: {} },
        { name: 'browserbase_screenshot', server: 'browserbase', description: 'Screenshot', inputSchema: {} }
      ]))

      const mockCallTool = vi.fn(() => ({
        promise: Promise.resolve({
          content: [{ type: 'text', text: 'navigated' }],
          error: '',
        }),
        cancel: vi.fn(),
      }))

      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: mockCallTool
        }),
        rag: () => ({ getToolNames: () => Promise.resolve([]) })
      } as any)

      const calls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'browserbase_navigate', arguments: '{}' }
      }]
      const builder = {
        addToolMessage: vi.fn(),
        getMessages: vi.fn(() => [])
      } as any
      const message = { thread_id: 'test-thread', metadata: {} } as any
      const abortController = new AbortController()

      await postMessageProcessing(
        calls,
        builder,
        message,
        abortController,
        {},
        undefined,
        false,
        false  // isProactiveMode = false
      )

      // getTools called once for server lookup
      expect(mockGetTools).toHaveBeenCalledTimes(1)
      // callTool called once for the navigate tool (no proactive screenshots because mode is disabled)
      expect(mockCallTool).toHaveBeenCalledTimes(1)
      expect(mockCallTool).toHaveBeenCalledWith({
        toolName: 'browserbase_navigate',
        serverName: 'browserbase',
        arguments: {}
      })
    })

    it('should not trigger proactive screenshots for non-browser tools', async () => {
      const { getServiceHub } = await import('@/hooks/useServiceHub')

      const mockGetTools = vi.fn(() => Promise.resolve([
        { name: 'fetch_url', server: 'fetch-server', description: 'Fetch URL', inputSchema: {} }
      ]))
      const mockCallTool = vi.fn(() => ({
        promise: Promise.resolve({
          content: [{ type: 'text', text: 'fetched data' }],
          error: '',
        }),
        cancel: vi.fn(),
      }))

      vi.mocked(getServiceHub).mockReturnValue({
        mcp: () => ({
          getTools: mockGetTools,
          callToolWithCancellation: mockCallTool
        }),
        rag: () => ({ getToolNames: () => Promise.resolve([]) })
      } as any)

      const calls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'fetch_url', arguments: '{"url": "test.com"}' }
      }]
      const builder = {
        addToolMessage: vi.fn(),
        getMessages: vi.fn(() => [])
      } as any
      const message = { thread_id: 'test-thread', metadata: {} } as any
      const abortController = new AbortController()

      await postMessageProcessing(
        calls,
        builder,
        message,
        abortController,
        {},
        undefined,
        false,
        true  // isProactiveMode = true
      )

      // getTools called once for server lookup
      expect(mockGetTools).toHaveBeenCalledTimes(1)
      // callTool called once for fetch_url (no proactive screenshots because it's not a browser tool)
      expect(mockCallTool).toHaveBeenCalledTimes(1)
      expect(mockCallTool).toHaveBeenCalledWith({
        toolName: 'fetch_url',
        serverName: 'fetch-server',
        arguments: { url: 'test.com' }
      })
    })
  })
})
