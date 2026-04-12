import { describe, expect, it } from 'vitest'

import { normalizeToolInputSchema } from '../custom-chat-transport'

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
})
