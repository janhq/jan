import { describe, it, expect } from 'vitest'
import {
  CompletionMessagesBuilder,
  extractToolCallsFromUIMessage,
} from '../messages'
import { ThreadMessage } from '@janhq/core'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import type { UIMessage } from '@ai-sdk/react'

// Mock thread messages for testing
const createMockThreadMessage = (
  role: 'user' | 'assistant' | 'system',
  content: string,
  hasError = false
): ThreadMessage => ({
  id: 'msg-123',
  object: 'thread.message',
  thread_id: 'thread-123',
  role,
  content: [
    {
      type: 'text' as any,
      text: {
        value: content,
        annotations: [],
      },
    },
  ],
  status: 'completed' as any,
  created_at: Date.now(),
  completed_at: Date.now(),
  metadata: hasError ? { error: true } : {},
})

describe('CompletionMessagesBuilder', () => {
  describe('constructor', () => {
    it('should initialize with empty messages array when no system instruction', () => {
      const messages: ThreadMessage[] = []
      const builder = new CompletionMessagesBuilder(messages)

      expect(builder.getMessages()).toEqual([])
    })

    it('should add system message when system instruction provided', () => {
      const messages: ThreadMessage[] = []
      const systemInstruction = 'You are a helpful assistant.'
      const builder = new CompletionMessagesBuilder(messages, systemInstruction)

      const result = builder.getMessages()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'system',
        content: systemInstruction,
      })
      expect(result[1]).toEqual({
        role: 'user',
        content: '.',
      })
    })

    it('should filter out messages with errors', () => {
      const messages: ThreadMessage[] = [
        createMockThreadMessage('user', 'Hello', false),
        createMockThreadMessage('assistant', 'Hi there', true), // has error
        createMockThreadMessage('user', 'How are you?', false),
      ]

      const builder = new CompletionMessagesBuilder(messages)
      const result = builder.getMessages()

      // getMessages() inserts a filler message between consecutive user messages
      expect(result).toHaveLength(3)
      expect(result[0].content).toBe('Hello')
      expect(result[1].role).toBe('assistant') // filler message
      expect(result[2].content).toBe('How are you?')
    })

    it('should normalize assistant message content', () => {
      const messages: ThreadMessage[] = [
        createMockThreadMessage(
          'assistant',
          '<think>Let me think...</think>Hello there!'
        ),
      ]

      const builder = new CompletionMessagesBuilder(messages)
      const result = builder.getMessages()

      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('.')
      expect(result[1].content).toBe('Hello there!')
    })

    it('should preserve user message content without normalization', () => {
      const messages: ThreadMessage[] = [
        createMockThreadMessage(
          'user',
          '<think>This should not be normalized</think>Hello'
        ),
      ]

      const builder = new CompletionMessagesBuilder(messages)
      const result = builder.getMessages()

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe(
        '<think>This should not be normalized</think>Hello'
      )
    })

    it('should handle messages with empty content', () => {
      const message: ThreadMessage = {
        ...createMockThreadMessage('user', ''),
        content: [{ type: 'text' as any, text: undefined }],
      }

      const builder = new CompletionMessagesBuilder([message])
      const result = builder.getMessages()

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('.')
    })

    it('should handle messages with missing text value', () => {
      const message: ThreadMessage = {
        ...createMockThreadMessage('user', ''),
        content: [
          { type: 'text' as any, text: { value: '', annotations: [] } },
        ],
      }

      const builder = new CompletionMessagesBuilder([message])
      const result = builder.getMessages()

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('.')
    })
  })

  describe('addUserMessage', () => {
    it('should add user message to messages array', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addUserMessage(
        createMockThreadMessage('user', 'Hello, how are you?')
      )

      const result = builder.getMessages()
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        role: 'user',
        content: 'Hello, how are you?',
      })
    })

    it('should not add consecutive user messages', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addUserMessage(createMockThreadMessage('user', 'First message'))
      builder.addUserMessage(createMockThreadMessage('user', 'Second message'))

      const result = builder.getMessages()
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Second message')
    })

    it('should handle empty user message', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addUserMessage(createMockThreadMessage('user', ''))

      const result = builder.getMessages()
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('')
    })
  })

  describe('addAssistantMessage', () => {
    it('should add assistant message with normalized content', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage('<think>Processing...</think>Hello!')

      const result = builder.getMessages()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'user',
        content: '.',
      })
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'Hello!',
        refusal: undefined,
        tool_calls: undefined,
      })
    })

    it('should add assistant message with refusal', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        'I cannot help with that',
        'Content policy violation'
      )

      const result = builder.getMessages()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'user',
        content: '.',
      })
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'I cannot help with that',
        refusal: 'Content policy violation',
        tool_calls: undefined,
      })
    })

    it('should add assistant message with tool calls', () => {
      const builder = new CompletionMessagesBuilder([])
      const toolCalls: ChatCompletionMessageToolCall[] = [
        {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location": "New York"}',
          },
        },
      ]

      builder.addAssistantMessage(
        'Let me check the weather',
        undefined,
        toolCalls
      )

      const result = builder.getMessages()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'user',
        content: '.',
      })
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'Let me check the weather',
        refusal: undefined,
        tool_calls: toolCalls,
      })
    })

    it('should handle assistant message with all parameters', () => {
      const builder = new CompletionMessagesBuilder([])
      const toolCalls: ChatCompletionMessageToolCall[] = [
        {
          id: 'call_456',
          type: 'function',
          function: {
            name: 'search',
            arguments: '{"query": "test"}',
          },
        },
      ]

      builder.addAssistantMessage(
        '<think>Searching...</think>Here are the results',
        'Cannot search sensitive content',
        toolCalls
      )

      const result = builder.getMessages()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'user',
        content: '.',
      })
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'Here are the results',
        refusal: 'Cannot search sensitive content',
        tool_calls: toolCalls,
      })
    })
  })

  describe('addToolMessage', () => {
    it('should add tool message with correct format', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addToolMessage('Weather data: 72°F', 'call_123')

      const result = builder.getMessages()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'user',
        content: '.',
      })
      expect(result[1]).toEqual({
        role: 'tool',
        content: 'Weather data: 72°F',
        tool_call_id: 'call_123',
      })
    })

    it('should add multiple tool messages', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addToolMessage('First tool result', 'call_1')
      builder.addToolMessage('Second tool result', 'call_2')

      const result = builder.getMessages()
      // getMessages() inserts a filler message between consecutive tool messages
      expect(result).toHaveLength(4)
      expect(result[0].role).toBe('user') // initial filler message
      expect(result[1].tool_call_id).toBe('call_1')
      expect(result[2].role).toBe('assistant') // filler message
      expect(result[3].tool_call_id).toBe('call_2')
    })

    it('should handle empty tool content', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addToolMessage('', 'call_123')

      const result = builder.getMessages()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'user',
        content: '.',
      })
      expect(result[1].content).toBe('')
      expect(result[1].tool_call_id).toBe('call_123')
    })
  })

  describe('getMessages', () => {
    it('should return messages in correct order', () => {
      const threadMessages: ThreadMessage[] = [
        createMockThreadMessage('user', 'Hello'),
      ]
      const builder = new CompletionMessagesBuilder(
        threadMessages,
        'You are helpful'
      )

      builder.addUserMessage(createMockThreadMessage('user', 'How are you?'))
      builder.addAssistantMessage('I am well, thank you!')
      builder.addToolMessage('Tool response', 'call_123')

      const result = builder.getMessages()
      expect(result).toHaveLength(4)
      expect(result[0].role).toBe('system')
      expect(result[1].role).toBe('user')
      expect(result[2].role).toBe('assistant')
      expect(result[3].role).toBe('tool')
    })

    it('should return the same array reference (not immutable)', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addUserMessage(createMockThreadMessage('user', 'Test message'))
      const result1 = builder.getMessages()

      builder.addAssistantMessage('Response')
      const result2 = builder.getMessages()

      // getMessages() creates a new array each time, so references will be different
      expect(result1).not.toBe(result2) // Different references because getMessages creates new array
      expect(result1).toHaveLength(1) // First call had only 1 message
      expect(result2).toHaveLength(2) // Second call has 2 messages
    })
  })

  describe('content normalization', () => {
    it('should remove thinking content from the beginning', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<think>Let me analyze this...</think>The answer is 42.'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('The answer is 42.')
    })

    it('should handle nested thinking tags', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<think>First thought<think>Nested</think>More thinking</think>Final answer'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('More thinking</think>Final answer')
    })

    it('should handle multiple thinking blocks', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<think>First</think>Answer<think>Second</think>More content'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('Answer<think>Second</think>More content')
    })

    it('should handle content without thinking tags', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage('Just a normal response')

      const result = builder.getMessages()
      expect(result[1].content).toBe('Just a normal response')
    })

    it('should handle empty content after removing thinking', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage('<think>Only thinking content</think>')

      const result = builder.getMessages()
      expect(result[1].content).toBe('')
    })

    it('should handle unclosed thinking tags', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<think>Unclosed thinking tag... Regular content'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe(
        '<think>Unclosed thinking tag... Regular content'
      )
    })

    it('should handle thinking tags with whitespace', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<think>  \n  Some thinking  \n  </think>  \n  Clean answer'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('Clean answer')
    })

    it('should remove analysis channel reasoning content', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<|channel|>analysis<|message|>Let me analyze this step by step...<|start|>assistant<|channel|>final<|message|>The final answer is 42.'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('The final answer is 42.')
    })

    it('should handle analysis channel without final message', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<|channel|>analysis<|message|>Only analysis content here...'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('<|channel|>analysis<|message|>Only analysis content here...')
    })

    it('should handle analysis channel with multiline content', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<|channel|>analysis<|message|>Step 1: First analysis\nStep 2: Second analysis\nStep 3: Final analysis<|start|>assistant<|channel|>final<|message|>Based on my analysis, here is the result.'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('Based on my analysis, here is the result.')
    })

    it('should handle both think and analysis channel tags', () => {
      const builder = new CompletionMessagesBuilder([])

      builder.addAssistantMessage(
        '<think>Initial thought</think><|channel|>analysis<|message|>Detailed analysis<|start|>assistant<|channel|>final<|message|>Final response'
      )

      const result = builder.getMessages()
      expect(result[1].content).toBe('Final response')
    })
  })

  describe('integration tests', () => {
    it('should handle complex conversation flow', () => {
      const threadMessages: ThreadMessage[] = [
        createMockThreadMessage('user', 'What is the weather like?'),
        createMockThreadMessage(
          'assistant',
          '<think>I need to call weather API</think>Let me check the weather for you.'
        ),
      ]

      const builder = new CompletionMessagesBuilder(
        threadMessages,
        'You are a weather assistant'
      )

      // Add tool call and response
      const toolCalls: ChatCompletionMessageToolCall[] = [
        {
          id: 'call_weather',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location": "user_location"}',
          },
        },
      ]

      builder.addAssistantMessage(
        'Calling weather service...',
        undefined,
        toolCalls
      )
      builder.addToolMessage(
        '{"temperature": 72, "condition": "sunny"}',
        'call_weather'
      )
      builder.addAssistantMessage(
        '<think>The weather is nice</think>The weather is 72°F and sunny!'
      )

      const result = builder.getMessages()

      // getMessages() adds filler messages between consecutive assistant messages
      expect(result).toHaveLength(7)
      expect(result[0].role).toBe('system')
      expect(result[1].role).toBe('user')
      expect(result[2].role).toBe('assistant')
      expect(result[2].content).toBe('Let me check the weather for you.')
      expect(result[3].role).toBe('user') // filler message inserted between consecutive assistant messages
      expect(result[4].role).toBe('assistant')
      expect(result[4].tool_calls).toEqual(toolCalls)
      expect(result[5].role).toBe('tool')
      expect(result[6].role).toBe('assistant')
      expect(result[6].content).toBe('The weather is 72°F and sunny!')
    })

    it('should handle empty thread messages with system instruction', () => {
      const builder = new CompletionMessagesBuilder([], 'System instruction')

      const result = builder.getMessages()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'system',
        content: 'System instruction',
      })
      expect(result[1]).toEqual({
        role: 'user',
        content: '.',
      })
    })
  })
})

describe('extractToolCallsFromUIMessage', () => {
  it('should return undefined when message has no tool calls', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello, how can I help?' }],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toBeUndefined()
  })

  it('should extract tool calls with string output', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-get_weather',
          toolInvocationId: 'call_123',
          toolName: 'get_weather',
          input: { location: 'New York' },
          output: 'The weather is 72°F and sunny',
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0]).toEqual({
      tool: {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: JSON.stringify({ location: 'New York' }),
        },
      },
      response: {
        content: [{ type: 'text', text: 'The weather is 72°F and sunny' }],
      },
      state: 'ready',
    })
  })

  it('should extract tool calls with array output', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-search',
          toolInvocationId: 'call_456',
          toolName: 'search',
          input: { query: 'test' },
          output: [
            { type: 'text', text: 'Search result 1' },
            { type: 'text', text: 'Search result 2' },
          ],
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0].response?.content).toEqual([
      { type: 'text', text: 'Search result 1' },
      { type: 'text', text: 'Search result 2' },
    ])
  })

  it('should extract tool calls with object containing content property', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-analyze',
          toolInvocationId: 'call_789',
          toolName: 'analyze',
          input: { data: 'sample' },
          result: {
            content: [{ type: 'text', text: 'Analysis complete' }],
          },
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0].response?.content).toEqual([
      { type: 'text', text: 'Analysis complete' },
    ])
  })

  it('should handle tool calls with complex object output (fallback to stringify)', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-complex',
          toolInvocationId: 'call_999',
          toolName: 'complex',
          input: { param: 'value' },
          output: { foo: 'bar', nested: { key: 'value' } },
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0].response?.content).toEqual([
      { type: 'text', text: JSON.stringify({ foo: 'bar', nested: { key: 'value' } }) },
    ])
  })

  it('should handle tool calls with toolCallId instead of toolInvocationId', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-test',
          toolCallId: 'call_alt',
          toolName: 'test',
          args: { key: 'value' },
          output: 'Test result',
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0].tool.id).toBe('call_alt')
  })

  it('should handle tool calls with args instead of input', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-test',
          toolInvocationId: 'call_abc',
          toolName: 'test',
          args: { param: 'value' },
          output: 'Result',
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0].tool.function.arguments).toBe(
      JSON.stringify({ param: 'value' })
    )
  })

  it('should handle multiple tool calls', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-first',
          toolInvocationId: 'call_1',
          toolName: 'first',
          input: { a: 1 },
          output: 'First result',
        },
        { type: 'text', text: 'Some text between' },
        {
          type: 'tool-second',
          toolInvocationId: 'call_2',
          toolName: 'second',
          input: { b: 2 },
          output: 'Second result',
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(2)
    expect(result?.[0].tool.function.name).toBe('first')
    expect(result?.[1].tool.function.name).toBe('second')
  })

  it('should ignore tool parts without output or result', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-pending',
          toolInvocationId: 'call_pending',
          toolName: 'pending',
          input: { data: 'test' },
          // No output or result
        },
        {
          type: 'tool-completed',
          toolInvocationId: 'call_completed',
          toolName: 'completed',
          input: { data: 'test' },
          output: 'Completed result',
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0].tool.function.name).toBe('completed')
  })

  it('should handle string input arguments', () => {
    const message: UIMessage = {
      id: 'msg-123',
      role: 'assistant',
      parts: [
        {
          type: 'tool-test',
          toolInvocationId: 'call_str',
          toolName: 'test',
          input: '{"key": "value"}',
          output: 'Result',
        },
      ],
    } as UIMessage

    const result = extractToolCallsFromUIMessage(message)
    expect(result).toHaveLength(1)
    expect(result?.[0].tool.function.arguments).toBe('{"key": "value"}')
  })
})
