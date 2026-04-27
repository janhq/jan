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

describe('parseReasoning', () => {
  it.each([
    ['no reasoning tags', 'Hello world', { reasoningSegment: undefined, textSegment: 'Hello world' }],
    ['in-progress <think>', '<think>thinking...', { reasoningSegment: '<think>thinking...', textSegment: '' }],
    ['in-progress <thought>', '<thought>thinking...', { reasoningSegment: '<thought>thinking...', textSegment: '' }],
    ['completed <think>', '<think>reason</think>answer', { reasoningSegment: '<think>reason</think>', textSegment: 'answer' }],
    ['completed <thought>', '<thought>reason</thought>answer', { reasoningSegment: '<thought>reason</thought>', textSegment: 'answer' }],
    ['text before tags', 'Some prefix <think>Internal thought</think>Some suffix', { reasoningSegment: 'Some prefix <think>Internal thought</think>', textSegment: 'Some suffix' }],
    ['multiple tags', '<think>First</think><think>Second</think>Answer', { reasoningSegment: '<think>First</think>', textSegment: '<think>Second</think>Answer' }],
  ])('handles %s', (_label, input, expected) => {
    expect(parseReasoning(input)).toEqual(expected)
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

describe('convertUIMessageToThreadMessage', () => {
  const mkUI = (overrides: Partial<UIMessage> = {}): UIMessage =>
    ({
      id: 'msg-1', role: 'assistant',
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
    expect(result.content[0]).toMatchObject({ type: ContentType.Text, text: { value: 'Hello', annotations: [] } })
    expect(result.created_at).toBe(1000)
  })

  it('converts reasoning parts', () => {
    const msg = mkUI({ parts: [{ type: 'reasoning', reasoning: 'thinking' } as any, { type: 'text', text: 'answer' }] })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect(result.content[0].text!.value).toContain('<think>thinking</think>')
  })

  it('handles reasoning with no existing text', () => {
    const msg = mkUI({ parts: [{ type: 'reasoning', reasoning: 'only thinking' } as any] })
    expect(convertUIMessageToThreadMessage(msg, 't1').content[0].text!.value).toBe('<think>only thinking</think>')
  })

  it('converts file parts (images)', () => {
    const msg = mkUI({ parts: [{ type: 'file', mediaType: 'image/png', url: 'http://img' } as any] })
    expect(convertUIMessageToThreadMessage(msg, 't1').content[0]).toMatchObject({
      type: ContentType.Image, image_url: { url: 'http://img', detail: 'auto' },
    })
  })

  it('ignores non-image file parts', () => {
    const msg = mkUI({ parts: [{ type: 'file', mediaType: 'application/pdf', url: 'http://f' } as any] })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe(ContentType.Text)
  })

  it('creates empty text when no content extracted', () => {
    const result = convertUIMessageToThreadMessage(mkUI({ parts: [] }), 't1')
    expect(result.content[0].text!.value).toBe('')
  })

  it('extracts tool calls from parts', () => {
    const msg = mkUI({
      parts: [
        { type: 'text', text: 'hi' },
        { type: 'tool-search', toolCallId: 'tc-1', input: { q: 'test' }, state: 'output-available', output: 'result' } as any,
      ],
    })
    const result = convertUIMessageToThreadMessage(msg, 't1')
    expect((result.metadata as any).tool_calls).toHaveLength(1)
    expect((result.metadata as any).tool_calls[0].tool.function.name).toBe('search')
  })

  it('uses Date.now() when metadata.createdAt is not a Date', () => {
    expect(convertUIMessageToThreadMessage(mkUI({ metadata: {} as any }), 't1').created_at).toBeGreaterThan(0)
  })
})

describe('convertUIMessagesToThreadMessages', () => {
  it('converts an array of UIMessages', () => {
    const msgs: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage,
      { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hey' }] } as UIMessage,
    ]
    const result = convertUIMessagesToThreadMessages(msgs, 'thread-1')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('1')
  })
})

describe('convertThreadMessageToUIMessage', () => {
  const makeTm = (overrides: any = {}) => ({
    id: 'tm-1', role: 'assistant' as const,
    content: [{ type: ContentType.Text, text: { value: 'Hello', annotations: [] } }],
    created_at: 1000, status: MessageStatus.Ready,
    object: 'thread.message' as const, thread_id: 't1',
    ...overrides,
  })

  it('converts text content', () => {
    const result = convertThreadMessageToUIMessage(makeTm() as any)
    expect(result.parts).toContainEqual({ type: 'text', text: 'Hello' })
  })

  it('converts reasoning content type directly', () => {
    const result = convertThreadMessageToUIMessage(makeTm({
      id: 'tm-2', content: [{ type: 'reasoning', text: { value: 'my reasoning', annotations: [] } }],
    }) as any)
    expect(result.parts).toContainEqual({ type: 'reasoning', text: 'my reasoning' })
  })

  it('handles old-format reasoning in <think> tags', () => {
    const result = convertThreadMessageToUIMessage(makeTm({
      content: [{ type: ContentType.Text, text: { value: '<think>reason</think>answer text', annotations: [] } }],
    }) as any)
    expect(result.parts).toContainEqual({ type: 'reasoning', text: 'reason' })
    expect(result.parts).toContainEqual({ type: 'text', text: 'answer text' })
  })

  it('handles in-progress think tag', () => {
    const result = convertThreadMessageToUIMessage(makeTm({
      content: [{ type: ContentType.Text, text: { value: '<think>thinking...', annotations: [] } }],
    }) as any)
    expect(result.parts).toContainEqual({ type: 'reasoning', text: 'thinking...' })
  })

  it('converts image_url content', () => {
    const result = convertThreadMessageToUIMessage(makeTm({
      role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://img.png' } }],
    }) as any)
    expect(result.parts).toContainEqual({ type: 'file', mediaType: 'image/jpeg', url: 'http://img.png' })
  })

  it('converts tool_call content with and without output', () => {
    const withOutput = convertThreadMessageToUIMessage(makeTm({
      content: [{ type: 'tool_call', tool_call_id: 'tc-1', tool_name: 'search', input: { q: 'test' }, output: 'result' }],
    }) as any)
    expect(withOutput.parts[0]).toMatchObject({ type: 'tool-search', state: 'output-available', output: 'result' })

    const withoutOutput = convertThreadMessageToUIMessage(makeTm({
      content: [{ type: 'tool_call', tool_call_id: 'tc-2', tool_name: 'fetch', input: { url: 'http://x' } }],
    }) as any)
    expect(withoutOutput.parts[0]).toMatchObject({ type: 'tool-fetch', state: 'input-available' })
  })

  it('handles backward-compatible tool calls in metadata', () => {
    const result = convertThreadMessageToUIMessage(makeTm({
      content: [{ type: ContentType.Text, text: { value: 'done', annotations: [] } }],
      metadata: {
        tool_calls: [{
          tool: { id: 'tc-old', function: { name: 'search', arguments: '{"q":"test"}' } },
          state: 'completed',
          response: { content: [{ type: 'text', text: 'found it' }] },
        }],
      },
    }) as any)
    const toolPart = result.parts.find((p: any) => p.type === 'tool-search')
    expect((toolPart as any).state).toBe('output-available')
    expect((toolPart as any).output).toBe('found it')
  })

  it('handles metadata tool calls with multiple content parts', () => {
    const result = convertThreadMessageToUIMessage(makeTm({
      content: [],
      metadata: {
        tool_calls: [{
          tool: { id: 'tc-m', function: { name: 'multi', arguments: { a: 1 } } },
          state: 'ready',
          response: { content: [{ type: 'text', text: 'part1' }, { type: 'image', data: 'abc' }] },
        }],
      },
    }) as any)
    const toolPart = result.parts.find((p: any) => p.type === 'tool-multi')
    expect((toolPart as any).output).toHaveLength(2)
  })

  it('handles metadata tool calls with pending state', () => {
    const result = convertThreadMessageToUIMessage(makeTm({
      content: [],
      metadata: {
        tool_calls: [{ tool: { id: 'tc-p', function: { name: 'pending', arguments: '{}' } }, state: 'pending' }],
      },
    }) as any)
    expect(result.parts.find((p: any) => p.type === 'tool-pending')).toMatchObject({ state: 'input-available' })
  })

  it('adds empty text part when no content', () => {
    const result = convertThreadMessageToUIMessage(makeTm({ content: [] }) as any)
    expect(result.parts).toEqual([{ type: 'text', text: '' }])
  })

  it('handles null/undefined content', () => {
    const result = convertThreadMessageToUIMessage(makeTm({ content: undefined, created_at: undefined }) as any)
    expect(result.parts).toHaveLength(1)
  })
})

describe('convertThreadMessagesToUIMessages', () => {
  it('converts and filters array', () => {
    const tms = [{
      id: '1', role: 'user' as const,
      content: [{ type: ContentType.Text, text: { value: 'hi', annotations: [] } }],
      created_at: 1000, status: MessageStatus.Ready,
      object: 'thread.message' as const, thread_id: 't1',
    }]
    const result = convertThreadMessagesToUIMessages(tms as any)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })
})

describe('extractContentPartsFromUIMessage', () => {
  it.each([
    ['text parts', { parts: [{ type: 'text', text: 'hello' }] }, (c: any[]) => {
      expect(c[0]).toMatchObject({ type: 'text', text: { value: 'hello' } })
    }],
    ['reasoning parts', { parts: [{ type: 'reasoning', text: 'thinking' }] }, (c: any[]) => {
      expect(c[0]).toMatchObject({ type: 'reasoning', text: { value: 'thinking' } })
    }],
    ['image file parts', { parts: [{ type: 'file', mediaType: 'image/png', url: 'http://img' }] }, (c: any[]) => {
      expect(c[0]).toMatchObject({ type: 'image_url', image_url: { url: 'http://img' } })
    }],
    ['non-image file parts', { parts: [{ type: 'file', mediaType: 'application/pdf', url: 'http://f' }] }, (c: any[]) => {
      expect(c[0].text!.value).toBe('')
    }],
    ['tool call parts', {
      parts: [{ type: 'tool-search', toolCallId: 'tc-1', input: { q: 'test' }, state: 'output-available', output: 'result' }],
    }, (c: any[]) => {
      expect(c[0]).toMatchObject({ type: 'tool_call', tool_call_id: 'tc-1', tool_name: 'search' })
    }],
    ['empty parts', { parts: [] }, (c: any[]) => {
      expect(c).toHaveLength(1)
      expect(c[0].text!.value).toBe('')
    }],
    ['undefined parts', {}, (c: any[]) => {
      expect(c).toHaveLength(1)
    }],
  ])('extracts %s', (_label, msgOverrides, verify) => {
    const msg = { id: '1', role: 'assistant', ...msgOverrides } as UIMessage
    verify(extractContentPartsFromUIMessage(msg))
  })

  it('skips empty text and reasoning parts', () => {
    const msg = {
      id: '1', role: 'assistant',
      parts: [{ type: 'reasoning', text: '' }, { type: 'text', text: '' }, { type: 'text', text: 'actual' }],
    } as UIMessage
    const content = extractContentPartsFromUIMessage(msg)
    expect(content).toHaveLength(1)
    expect(content[0].text!.value).toBe('actual')
  })
})
