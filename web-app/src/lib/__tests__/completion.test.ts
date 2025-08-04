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
  postMessageProcessing
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
})