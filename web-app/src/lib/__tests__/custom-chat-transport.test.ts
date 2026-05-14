import { describe, expect, it } from 'vitest'

import {
  buildLlamacppReasoningParams,
  normalizeToolInputSchema,
} from '../custom-chat-transport'

describe('normalizeToolInputSchema', () => {
  it('adds empty properties for object schemas without properties', () => {
    expect(normalizeToolInputSchema({ type: 'object' })).toEqual({
      type: 'object',
      properties: {},
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
