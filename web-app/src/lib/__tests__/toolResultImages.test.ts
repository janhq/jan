import { describe, it, expect } from 'vitest'
import { type UIMessage } from '@ai-sdk/react'

import { prepareToolResultImagesForModel } from '../toolResultImages'

const IMG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const toolMessageWithImage = (): UIMessage =>
  ({
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-get_viewport_screenshot',
        toolCallId: 'call_1',
        state: 'output-available',
        input: {},
        output: [
          { type: 'text', text: 'Screenshot taken' },
          { type: 'image', data: IMG_B64, mimeType: 'image/png' },
        ],
      },
    ],
  }) as unknown as UIMessage

const getToolOutput = (message: UIMessage): unknown[] => {
  const part = (message.parts as Array<Record<string, unknown>>)[0]
  return part.output as unknown[]
}

describe('prepareToolResultImagesForModel', () => {
  it('strips image base64 from tool output and replaces it with a text placeholder (non-vision)', () => {
    const [msg] = prepareToolResultImagesForModel([toolMessageWithImage()], {
      supportsVision: false,
    })

    const output = getToolOutput(msg)
    // No raw image block survives in the model-bound payload.
    expect(output.some((b) => (b as Record<string, unknown>).type === 'image')).toBe(false)
    // The original text block is preserved; the image becomes a placeholder.
    expect(output).toHaveLength(2)
    const placeholder = output[1] as { type: string; text: string }
    expect(placeholder.type).toBe('text')
    expect(placeholder.text).toContain('omitted')
    expect(JSON.stringify(output)).not.toContain(IMG_B64)
  })

  it('does NOT hoist a separate image message for non-vision models', () => {
    const result = prepareToolResultImagesForModel([toolMessageWithImage()], {
      supportsVision: false,
    })
    expect(result).toHaveLength(1)
  })

  it('hoists the image as an image_url user message for vision models', () => {
    const result = prepareToolResultImagesForModel([toolMessageWithImage()], {
      supportsVision: true,
    })

    expect(result).toHaveLength(2)
    const hoisted = result[1]
    expect(hoisted.role).toBe('user')

    const parts = hoisted.parts as Array<Record<string, unknown>>
    const filePart = parts.find((p) => p.type === 'file')
    expect(filePart).toBeDefined()
    expect(filePart?.mediaType).toBe('image/png')
    expect(String(filePart?.url)).toContain(IMG_B64)

    // The tool output itself still carries no raw image (only the placeholder).
    const output = getToolOutput(result[0])
    expect(output.some((b) => (b as Record<string, unknown>).type === 'image')).toBe(false)
  })

  it('leaves messages without tool-result images untouched (same reference)', () => {
    const plain = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    } as unknown as UIMessage

    const result = prepareToolResultImagesForModel([plain], {
      supportsVision: true,
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(plain)
  })
})
