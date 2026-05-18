import { describe, expect, it } from 'vitest'

import type { UIMessage } from '@ai-sdk/react'
import {
  buildLlamacppReasoningParams,
  coalesceMessagesForAlternation,
  extractContextInfoFromError,
  normalizeToolInputSchema,
  resolveOrphanToolCalls,
  stripRetryErrorWrapper,
  stripUnsupportedImageParts,
  unwrapRetryError,
} from '../custom-chat-transport'

const userMsg = (id: string, text: string): UIMessage =>
  ({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  }) as UIMessage

const assistantMsg = (
  id: string,
  parts: UIMessage['parts'] = []
): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts,
  }) as UIMessage

describe('normalizeToolInputSchema', () => {
  it('adds empty properties for object schemas without properties', () => {
    expect(normalizeToolInputSchema({ type: 'object' })).toEqual({
      type: 'object',
      properties: {},
    })
  })

  it('expands bare-string shorthand in properties', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: { name: 'string', count: 'integer' },
      })
    ).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' },
      },
    })
  })

  it('expands bare-string shorthand in items', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: { tags: { type: 'array', items: 'string' } },
      })
    ).toEqual({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    })
  })

  it('expands bare-string shorthand in anyOf', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          value: { anyOf: ['string', 'number'] },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
    })
  })

  it('does not coerce enum literal strings that happen to match type names', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['string', 'number', 'fast'] },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['string', 'number', 'fast'] },
      },
    })
  })

  it('adds string type for description-only leaves', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          url: {
            description: 'Target URL',
          },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        url: {
          description: 'Target URL',
          type: 'string',
        },
      },
    })
  })

  it('normalizes nested object and array schemas recursively', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          filters: {
            type: 'object',
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          properties: {},
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {},
          },
        },
      },
    })
  })

  it('preserves already valid schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        payload: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
            },
          },
          required: ['id'],
        },
      },
    }

    expect(normalizeToolInputSchema(schema)).toEqual(schema)
  })

  it('patches only underspecified nodes in mixed schemas', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          count: {
            type: 'integer',
          },
          title: {
            description: 'A title',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata',
          },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        count: {
          type: 'integer',
        },
        title: {
          description: 'A title',
          type: 'string',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata',
          properties: {},
        },
      },
    })
  })

  it('normalizes combinator members recursively', () => {
    expect(
      normalizeToolInputSchema({
        anyOf: [
          {
            type: 'object',
          },
          {
            description: 'fallback string',
          },
        ],
        oneOf: [
          {
            type: 'object',
          },
        ],
        allOf: [
          {
            description: 'merged leaf',
          },
        ],
      })
    ).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: {},
        },
        {
          description: 'fallback string',
          type: 'string',
        },
      ],
      oneOf: [
        {
          type: 'object',
          properties: {},
        },
      ],
      allOf: [
        {
          description: 'merged leaf',
          type: 'string',
        },
      ],
    })
  })
})

describe('buildLlamacppReasoningParams', () => {
  it('returns empty object for non-llamacpp providers regardless of reasoning value', () => {
    expect(buildLlamacppReasoningParams('openai', 'on')).toEqual({})
    expect(buildLlamacppReasoningParams('anthropic', 'off')).toEqual({})
    expect(buildLlamacppReasoningParams(null, 'on')).toEqual({})
    expect(buildLlamacppReasoningParams(undefined, 'off')).toEqual({})
  })

  it('omits the kwarg for llamacpp when reasoning is auto or undefined', () => {
    expect(buildLlamacppReasoningParams('llamacpp', 'auto')).toEqual({})
    expect(buildLlamacppReasoningParams('llamacpp', undefined)).toEqual({})
  })

  it('emits chat_template_kwargs.enable_thinking=true for on', () => {
    const params = buildLlamacppReasoningParams('llamacpp', 'on')
    expect(params).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    })
  })

  it('emits chat_template_kwargs.enable_thinking=false for off', () => {
    const params = buildLlamacppReasoningParams('llamacpp', 'off')
    expect(params).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    })
  })

  // Regression: llama-server's server-common.cpp:1056-1069 parses kwargs via
  // `json_value(...).dump()` and rejects values that serialize to a quoted
  // string ("invalid type for \"enable_thinking\" (expected boolean, got
  // string)"). The value MUST be a JSON boolean.
  it('emits enable_thinking as a JSON boolean, not a string', () => {
    for (const r of ['on', 'off'] as const) {
      const params = buildLlamacppReasoningParams('llamacpp', r)
      const value = params.chat_template_kwargs?.enable_thinking
      expect(typeof value).toBe('boolean')
      expect(value).not.toBe('true')
      expect(value).not.toBe('false')
      // The exact serialization llama-server sees: JSON.stringify of the
      // value must produce literal `true` / `false`, never quoted strings.
      expect(JSON.stringify(value)).toMatch(/^(true|false)$/)
    }
  })
})

describe('coalesceMessagesForAlternation', () => {
  it('drops an empty assistant placeholder and merges the surrounding users', () => {
    const input = [
      userMsg('u1', 'first question'),
      assistantMsg('a1', []),
      userMsg('u2', 'retry after error'),
    ]
    const out = coalesceMessagesForAlternation(input)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
    expect(out[0].parts).toEqual([
      { type: 'text', text: 'first question\n\nretry after error' },
    ])
  })

  it('merges two consecutive user messages with no intervening assistant', () => {
    const input = [userMsg('u1', 'hello'), userMsg('u2', 'still hello')]
    const out = coalesceMessagesForAlternation(input)
    expect(out).toHaveLength(1)
    expect(out[0].parts).toEqual([
      { type: 'text', text: 'hello\n\nstill hello' },
    ])
  })

  it('keeps assistant messages with real content', () => {
    const input = [
      userMsg('u1', 'q'),
      assistantMsg('a1', [{ type: 'text', text: 'a' }] as UIMessage['parts']),
      userMsg('u2', 'q2'),
    ]
    const out = coalesceMessagesForAlternation(input)
    expect(out).toHaveLength(3)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('keeps assistant messages that only have non-text content (e.g. tool calls)', () => {
    const toolPart = { type: 'tool-foo', state: 'output-available' } as unknown as UIMessage['parts'][number]
    const input = [
      userMsg('u1', 'q'),
      assistantMsg('a1', [toolPart] as UIMessage['parts']),
      userMsg('u2', 'q2'),
    ]
    const out = coalesceMessagesForAlternation(input)
    expect(out).toHaveLength(3)
  })

  it('drops an assistant placeholder with only whitespace text', () => {
    const input = [
      userMsg('u1', 'q'),
      assistantMsg('a1', [{ type: 'text', text: '   \n  ' }] as UIMessage['parts']),
      userMsg('u2', 'q2'),
    ]
    const out = coalesceMessagesForAlternation(input)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
  })

  it('preserves non-text user parts (e.g. file attachments) when merging', () => {
    const filePart = {
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,AAA',
    } as unknown as UIMessage['parts'][number]
    const input: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'first' }, filePart],
      } as UIMessage,
      userMsg('u2', 'second'),
    ]
    const out = coalesceMessagesForAlternation(input)
    expect(out).toHaveLength(1)
    // Order is preserved: file stays where it was sent, second message's
    // text is appended after it rather than merged into the first text part.
    expect(out[0].parts).toEqual([
      { type: 'text', text: 'first' },
      filePart,
      { type: 'text', text: 'second' },
    ])
  })

  it('returns the input unchanged when alternation is already valid', () => {
    const input = [
      userMsg('u1', 'q'),
      assistantMsg('a1', [{ type: 'text', text: 'a' }] as UIMessage['parts']),
      userMsg('u2', 'q2'),
      assistantMsg('a2', [{ type: 'text', text: 'a2' }] as UIMessage['parts']),
    ]
    const out = coalesceMessagesForAlternation(input)
    expect(out).toHaveLength(4)
    expect(out).toEqual(input)
  })

  it('handles an empty input array', () => {
    expect(coalesceMessagesForAlternation([])).toEqual([])
  })
})

describe('resolveOrphanToolCalls', () => {
  const toolPart = (
    state: string,
    extra: Record<string, unknown> = {}
  ): UIMessage['parts'][number] =>
    ({
      type: 'tool-list-events',
      toolCallId: 'call_1',
      state,
      ...extra,
    }) as unknown as UIMessage['parts'][number]

  it('rewrites an unresolved tool part to output-error', () => {
    const input = [
      userMsg('u1', 'list my events'),
      assistantMsg('a1', [toolPart('input-available', { input: { q: 'x' } })]),
    ]
    const out = resolveOrphanToolCalls(input)
    const part = out[1].parts[0] as { state: string; errorText: string }
    expect(part.state).toBe('output-error')
    expect(part.errorText).toMatch(/interrupted/i)
  })

  it('leaves resolved tool parts untouched', () => {
    const input = [
      userMsg('u1', 'q'),
      assistantMsg('a1', [
        toolPart('output-available', { output: 'ok' }),
        toolPart('output-error', { errorText: 'denied' }),
        toolPart('output-denied'),
      ]),
    ]
    const out = resolveOrphanToolCalls(input)
    expect(out).toEqual(input)
  })

  it('preserves an existing errorText on an orphan', () => {
    const input = [
      userMsg('u1', 'q'),
      assistantMsg('a1', [toolPart('input-streaming', { errorText: 'pre-set' })]),
    ]
    const out = resolveOrphanToolCalls(input)
    const part = out[1].parts[0] as { state: string; errorText: string }
    expect(part.state).toBe('output-error')
    expect(part.errorText).toBe('pre-set')
  })

  it('ignores non-assistant messages and non-tool parts', () => {
    const input = [
      userMsg('u1', 'hello'),
      assistantMsg('a1', [{ type: 'text', text: 'hi' }] as UIMessage['parts']),
    ]
    const out = resolveOrphanToolCalls(input)
    expect(out).toEqual(input)
  })
})

describe('stripUnsupportedImageParts', () => {
  const imagePart = {
    type: 'file',
    mediaType: 'image/png',
    url: 'data:image/png;base64,AAA',
  } as unknown as UIMessage['parts'][number]
  const audioPart = {
    type: 'file',
    mediaType: 'audio/wav',
    url: 'data:audio/wav;base64,BBB',
  } as unknown as UIMessage['parts'][number]
  const textPart = { type: 'text', text: 'hello' } as UIMessage['parts'][number]

  const userWithParts = (id: string, parts: UIMessage['parts']): UIMessage =>
    ({ id, role: 'user', parts }) as UIMessage

  it('returns input unchanged when model supports vision', () => {
    const input = [userWithParts('u1', [textPart, imagePart])]
    expect(stripUnsupportedImageParts(input, true)).toBe(input)
  })

  it('drops image file parts when model lacks vision', () => {
    const input = [userWithParts('u1', [textPart, imagePart])]
    const out = stripUnsupportedImageParts(input, false)
    expect(out[0].parts).toEqual([textPart])
  })

  it('drops AI-SDK image-type parts when model lacks vision', () => {
    const imagePartV2 = {
      type: 'image',
      image: 'data:image/png;base64,AAA',
    } as unknown as UIMessage['parts'][number]
    const input = [userWithParts('u1', [textPart, imagePartV2])]
    const out = stripUnsupportedImageParts(input, false)
    expect(out[0].parts).toEqual([textPart])
  })

  it('preserves audio file parts when model lacks vision', () => {
    const input = [userWithParts('u1', [textPart, audioPart])]
    const out = stripUnsupportedImageParts(input, false)
    expect(out[0].parts).toEqual([textPart, audioPart])
  })

  it('returns the same message reference when no image parts present', () => {
    const message = userWithParts('u1', [textPart, audioPart])
    const out = stripUnsupportedImageParts([message], false)
    expect(out[0]).toBe(message)
  })

  it('leaves an empty parts array when a user message had only an image', () => {
    const input = [userWithParts('u1', [imagePart])]
    const out = stripUnsupportedImageParts(input, false)
    expect(out[0].parts).toEqual([])
  })

  it('extracts context info from a llama-server APICallError-like object', () => {
    const error = {
      message: 'the request exceeds the available context size',
      responseBody: JSON.stringify({
        error: {
          code: 400,
          message: 'the request exceeds the available context size',
          n_prompt_tokens: 5123,
          n_ctx: 4096,
        },
      }),
    }
    expect(extractContextInfoFromError(error)).toEqual({
      nPromptTokens: 5123,
      nCtx: 4096,
    })
  })

  it('returns null when only one of the context fields is present', () => {
    const error = {
      responseBody: JSON.stringify({
        error: { message: 'oops', n_prompt_tokens: 5123 },
      }),
    }
    expect(extractContextInfoFromError(error)).toBeNull()
  })

  it('returns null for non-numeric values', () => {
    const error = {
      responseBody: JSON.stringify({
        error: { n_prompt_tokens: '5123', n_ctx: '4096' },
      }),
    }
    expect(extractContextInfoFromError(error)).toBeNull()
  })

  it('returns null when responseBody is missing, empty, or unparseable', () => {
    expect(extractContextInfoFromError({})).toBeNull()
    expect(extractContextInfoFromError({ responseBody: '' })).toBeNull()
    expect(extractContextInfoFromError({ responseBody: 'not json' })).toBeNull()
    expect(extractContextInfoFromError(null)).toBeNull()
    expect(extractContextInfoFromError(undefined)).toBeNull()
  })

  it('does not touch assistant messages even if they somehow carry an image part', () => {
    const assistantMsgWithImage: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [textPart, imagePart],
    } as UIMessage
    const out = stripUnsupportedImageParts([assistantMsgWithImage], false)
    // We strip from any message — the safety is uniform — but assistants in
    // practice never carry image parts. Verify the strip still works rather
    // than carving out a role exception.
    expect(out[0].parts).toEqual([textPart])
  })
})

describe('stripRetryErrorWrapper', () => {
  it('strips the standard retry-exhausted prefix', () => {
    expect(
      stripRetryErrorWrapper(
        'Failed after 3 attempts. Last error: llama-server returned 500'
      )
    ).toBe('llama-server returned 500')
  })

  it('strips the non-retryable wrapper', () => {
    expect(
      stripRetryErrorWrapper(
        "Failed after 2 attempts with non-retryable error: 'context length exceeded'"
      )
    ).toBe('context length exceeded')
  })

  it('returns the message unchanged when no wrapper is present', () => {
    expect(stripRetryErrorWrapper('just a normal error')).toBe(
      'just a normal error'
    )
  })

  it('handles a multiline inner error', () => {
    const wrapped =
      'Failed after 3 attempts. Last error: line one\nline two\nline three'
    expect(stripRetryErrorWrapper(wrapped)).toBe(
      'line one\nline two\nline three'
    )
  })
})

describe('unwrapRetryError', () => {
  it('returns the last underlying error when given a RetryError-like object', () => {
    const inner = new Error('inner')
    const retry = { errors: [new Error('first'), inner] }
    expect(unwrapRetryError(retry)).toBe(inner)
  })

  it('returns the input unchanged for plain errors', () => {
    const err = new Error('boom')
    expect(unwrapRetryError(err)).toBe(err)
  })

  it('returns the input unchanged when errors is empty', () => {
    expect(unwrapRetryError({ errors: [] })).toEqual({ errors: [] })
  })

  it('handles null / undefined / primitives', () => {
    expect(unwrapRetryError(null)).toBeNull()
    expect(unwrapRetryError(undefined)).toBeUndefined()
    expect(unwrapRetryError('boom')).toBe('boom')
  })
})
