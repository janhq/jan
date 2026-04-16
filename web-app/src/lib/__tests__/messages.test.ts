import { describe, it, expect } from 'vitest'
import { ContentType, MessageStatus } from '@janhq/core'
import type { UIMessage } from '@ai-sdk/react'
import {
  convertUIMessageToThreadMessage,
  convertUIMessagesToThreadMessages,
  convertThreadMessageToUIMessage,
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
  parseReasoning,
} from '../messages'

// ---------------------------------------------------------------------------
// parseReasoning
// ---------------------------------------------------------------------------
describe('parseReasoning', () => {
  it('returns text only when no reasoning tags', () => {
    const result = parseReasoning('Hello world')
    expect(result).toEqual({ reasoningSegment: undefined, textSegment: 'Hello world' })
  })

  it('detects in-progress <think> tag (no closing)', () => {
    const result = parseReasoning('<think>thinking...')
    expect(result).toEqual({ reasoningSegment: '<think>thinking...', textSegment: '' })
  })

  it('detects completed <think> tag', () => {
    const result = parseReasoning('<think>reason</think>answer')
    expect(result.reasoningSegment).toBe('<think>reason</think>')
    expect(result.textSegment).toBe('answer')
  })

  it('detects in-progress analysis channel', () => {
    const text = '<|channel|>analysis<|message|>analyzing...'
    const result = parseReasoning(text)
    expect(result.reasoningSegment).toBe(text)
    expect(result.textSegment).toBe('')
  })

  it('detects completed analysis channel', () => {
    const text = '<|channel|>analysis<|message|>done<|start|>assistant<|channel|>final<|message|>reply'
    const result = parseReasoning(text)
    expect(result.reasoningSegment).toContain('<|channel|>analysis')
    expect(result.textSegment).toBe('reply')
  })
})

// ---------------------------------------------------------------------------
// convertUIMessageToThreadMessage
// ---------------------------------------------------------------------------
describe('convertUIMessageToThreadMessage', () => {
  const mkUI = (overrides: Partial<UIMessage> = {}): UIMessage =>
    ({
      id: 'msg-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello' }],
      metadata: { createdAt: new Date(1000) },
      ...overrides,
    }) as UIMessage

  it('converts a simple text message', () => {
    const result = convertUIMessageToThreadMessage(mkUI(), 'thread-1')
    expect(result.id).toBe('msg-1')
    expect(result.thread_id).toBe('thread-1')
    expect(result.role).toBe('assistant')
    expect(result.status).toBe(MessageStatus.Ready)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({
      type: ContentType.Text,
      text: { value: 'Hello', annotations: [] },
    })
    expect(result.created_at).toBe(1000)
  })

  it('converts reasoning parts', () => {
    const msg = mkUI({
      parts: [
        { type: 'reasoning', reasoning: 'thinking' } as any,
        { type: 'text', text: 'answer' },
      ],
    })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    // reasoning is prepended to existing text content
    expect(result.content[0].text!.value).toContain('<think>thinking</think>')
  })

  it('handles reasoning with no existing text', () => {
    const msg = mkUI({
      parts: [{ type: 'reasoning', reasoning: 'only thinking' } as any],
    })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect(result.content[0].text!.value).toBe('<think>only thinking</think>')
  })

  it('converts file parts (images)', () => {
    const msg = mkUI({
      parts: [{ type: 'file', mediaType: 'image/png', url: 'http://img' } as any],
    })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect(result.content[0]).toMatchObject({
      type: ContentType.Image,
      image_url: { url: 'http://img', detail: 'auto' },
    })
  })

  it('ignores non-image file parts', () => {
    const msg = mkUI({
      parts: [{ type: 'file', mediaType: 'application/pdf', url: 'http://f' } as any],
    })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    // no image content, falls back to empty text
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe(ContentType.Text)
    expect(result.content[0].text!.value).toBe('')
  })

  it('creates empty text when no content extracted', () => {
    const msg = mkUI({ parts: [] })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect(result.content).toHaveLength(1)
    expect(result.content[0].text!.value).toBe('')
  })

  it('extracts tool calls from parts', () => {
    const msg = mkUI({
      parts: [
        { type: 'text', text: 'hi' },
        {
          type: 'tool-search',
          toolCallId: 'tc-1',
          input: { q: 'test' },
          state: 'output-available',
          output: 'result',
        } as any,
      ],
    })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect(result.metadata).toBeDefined()
    expect((result.metadata as any).tool_calls).toHaveLength(1)
    expect((result.metadata as any).tool_calls[0].tool.function.name).toBe('search')
  })

  it('uses Date.now() when metadata.createdAt is not a Date', () => {
    const msg = mkUI({ metadata: {} as any })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect(result.created_at).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// convertUIMessagesToThreadMessages
// ---------------------------------------------------------------------------
describe('convertUIMessagesToThreadMessages', () => {
  it('converts an array of UIMessages', () => {
    const msgs: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage,
      { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hey' }] } as UIMessage,
    ]
    const result = convertUIMessagesToThreadMessages(msgs, 'thread-1')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('1')
    expect(result[1].id).toBe('2')
  })
})

// ---------------------------------------------------------------------------
// convertThreadMessageToUIMessage
// ---------------------------------------------------------------------------
describe('convertThreadMessageToUIMessage', () => {
  it('converts text content', () => {
    const tm = {
      id: 'tm-1',
      role: 'assistant' as const,
      content: [{ type: ContentType.Text, text: { value: 'Hello', annotations: [] } }],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.id).toBe('tm-1')
    expect(result.parts).toContainEqual({ type: 'text', text: 'Hello' })
  })

  it('converts reasoning content type directly', () => {
    const tm = {
      id: 'tm-2',
      role: 'assistant' as const,
      content: [{ type: 'reasoning', text: { value: 'my reasoning', annotations: [] } }],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts).toContainEqual({ type: 'reasoning', text: 'my reasoning' })
  })

  it('handles old-format reasoning in <think> tags', () => {
    const tm = {
      id: 'tm-3',
      role: 'assistant' as const,
      content: [
        {
          type: ContentType.Text,
          text: { value: '<think>reason</think>answer text', annotations: [] },
        },
      ],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts).toContainEqual({ type: 'reasoning', text: 'reason' })
    expect(result.parts).toContainEqual({ type: 'text', text: 'answer text' })
  })

  it('handles in-progress think tag', () => {
    const tm = {
      id: 'tm-4',
      role: 'assistant' as const,
      content: [
        { type: ContentType.Text, text: { value: '<think>thinking...', annotations: [] } },
      ],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts).toContainEqual({ type: 'reasoning', text: 'thinking...' })
  })

  it('converts image_url content', () => {
    const tm = {
      id: 'tm-5',
      role: 'user' as const,
      content: [{ type: 'image_url', image_url: { url: 'http://img.png' } }],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts).toContainEqual({
      type: 'file',
      mediaType: 'image/jpeg',
      url: 'http://img.png',
    })
  })

  it('converts tool_call content items with output', () => {
    const tm = {
      id: 'tm-6',
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_call',
          tool_call_id: 'tc-1',
          tool_name: 'search',
          input: { q: 'test' },
          output: 'result',
        },
      ],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts[0]).toMatchObject({
      type: 'tool-search',
      toolCallId: 'tc-1',
      state: 'output-available',
      output: 'result',
    })
  })

  it('converts tool_call content items without output', () => {
    const tm = {
      id: 'tm-7',
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_call',
          tool_call_id: 'tc-2',
          tool_name: 'fetch',
          input: { url: 'http://x' },
        },
      ],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts[0]).toMatchObject({
      type: 'tool-fetch',
      state: 'input-available',
    })
  })

  it('handles backward-compatible tool calls in metadata', () => {
    const tm = {
      id: 'tm-8',
      role: 'assistant' as const,
      content: [{ type: ContentType.Text, text: { value: 'done', annotations: [] } }],
      metadata: {
        tool_calls: [
          {
            tool: {
              id: 'tc-old',
              function: { name: 'search', arguments: '{"q":"test"}' },
            },
            state: 'completed',
            response: { content: [{ type: 'text', text: 'found it' }] },
          },
        ],
      },
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    const toolPart = result.parts.find((p: any) => p.type === 'tool-search')
    expect(toolPart).toBeDefined()
    expect((toolPart as any).state).toBe('output-available')
    expect((toolPart as any).output).toBe('found it')
  })

  it('handles metadata tool calls with multiple content parts', () => {
    const tm = {
      id: 'tm-9',
      role: 'assistant' as const,
      content: [],
      metadata: {
        tool_calls: [
          {
            tool: {
              id: 'tc-m',
              function: { name: 'multi', arguments: { a: 1 } },
            },
            state: 'ready',
            response: {
              content: [
                { type: 'text', text: 'part1' },
                { type: 'image', data: 'abc' },
              ],
            },
          },
        ],
      },
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    const toolPart = result.parts.find((p: any) => p.type === 'tool-multi')
    expect((toolPart as any).state).toBe('output-available')
    // Multiple content parts returned as array
    expect((toolPart as any).output).toHaveLength(2)
  })

  it('handles metadata tool calls with pending state', () => {
    const tm = {
      id: 'tm-10',
      role: 'assistant' as const,
      content: [],
      metadata: {
        tool_calls: [
          {
            tool: {
              id: 'tc-p',
              function: { name: 'pending', arguments: '{}' },
            },
            state: 'pending',
          },
        ],
      },
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    const toolPart = result.parts.find((p: any) => p.type === 'tool-pending')
    expect((toolPart as any).state).toBe('input-available')
  })

  it('adds empty text part when no content', () => {
    const tm = {
      id: 'tm-11',
      role: 'assistant' as const,
      content: [],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0]).toEqual({ type: 'text', text: '' })
  })

  it('handles null/undefined content', () => {
    const tm = {
      id: 'tm-12',
      role: 'assistant' as const,
      content: undefined,
      created_at: undefined,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts).toHaveLength(1)
  })

  it('handles text with no reasoning that is plain', () => {
    const tm = {
      id: 'tm-13',
      role: 'assistant' as const,
      content: [{ type: ContentType.Text, text: { value: 'just text', annotations: [] } }],
      created_at: 1000,
      status: MessageStatus.Ready,
      object: 'thread.message' as const,
      thread_id: 't1',
    }
    const result = convertThreadMessageToUIMessage(tm as any)
    expect(result.parts).toContainEqual({ type: 'text', text: 'just text' })
  })
})

// ---------------------------------------------------------------------------
// convertThreadMessagesToUIMessages
// ---------------------------------------------------------------------------
describe('convertThreadMessagesToUIMessages', () => {
  it('converts and filters array', () => {
    const tms = [
      {
        id: '1',
        role: 'user' as const,
        content: [{ type: ContentType.Text, text: { value: 'hi', annotations: [] } }],
        created_at: 1000,
        status: MessageStatus.Ready,
        object: 'thread.message' as const,
        thread_id: 't1',
      },
    ]
    const result = convertThreadMessagesToUIMessages(tms as any)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// extractContentPartsFromUIMessage
// ---------------------------------------------------------------------------
describe('extractContentPartsFromUIMessage', () => {
  it('extracts text parts', () => {
    const msg = { id: '1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({ type: 'text', text: { value: 'hello' } })
  })

  it('extracts reasoning parts', () => {
    const msg = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'thinking' }],
    } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    expect(content[0]).toMatchObject({ type: 'reasoning', text: { value: 'thinking' } })
  })

  it('extracts image file parts', () => {
    const msg = {
      id: '1',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'image/png', url: 'http://img' }],
    } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    expect(content[0]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'http://img', detail: 'auto' },
    })
  })

  it('ignores non-image file parts', () => {
    const msg = {
      id: '1',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'application/pdf', url: 'http://f' }],
    } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    // Falls back to empty text
    expect(content).toHaveLength(1)
    expect(content[0].text!.value).toBe('')
  })

  it('extracts tool call parts', () => {
    const msg = {
      id: '1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-search',
          toolCallId: 'tc-1',
          input: { q: 'test' },
          output: 'result',
        },
      ],
    } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    expect(content[0]).toMatchObject({
      type: 'tool_call',
      tool_call_id: 'tc-1',
      tool_name: 'search',
      input: { q: 'test' },
      output: 'result',
    })
  })

  it('returns empty text when no parts', () => {
    const msg = { id: '1', role: 'assistant', parts: [] } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    expect(content).toHaveLength(1)
    expect(content[0].text!.value).toBe('')
  })

  it('returns empty text when parts is undefined', () => {
    const msg = { id: '1', role: 'assistant' } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    expect(content).toHaveLength(1)
  })

  it('skips empty text and reasoning parts', () => {
    const msg = {
      id: '1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '' },
        { type: 'text', text: '' },
        { type: 'text', text: 'actual' },
      ],
    } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    // Empty reasoning and text are skipped; only 'actual' kept
    expect(content).toHaveLength(1)
    expect(content[0].text!.value).toBe('actual')
  })
})
