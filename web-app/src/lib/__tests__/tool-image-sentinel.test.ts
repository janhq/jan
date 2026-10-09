import { describe, it, expect } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type { ModelMessage } from 'ai'
import {
  encodeMcpToolImages,
  encodeToolImageSentinel,
  hasToolImageSentinel,
  splitToolImageSentinels,
  stripToolImageSentinels,
  toContentToolOutputs,
} from '../tool-image-sentinel'
import { decodeToolImageSentinelsInBody } from '../model-factory'
import { stripUnsupportedImageParts } from '../custom-chat-transport'

const png = 'data:image/png;base64,iVBORw0KGgo='

describe('tool-image-sentinel', () => {
  it('round-trips a sentinel back to an image_url part', () => {
    const encoded = encodeToolImageSentinel(png)
    expect(hasToolImageSentinel(encoded)).toBe(true)
    expect(splitToolImageSentinels(encoded)).toEqual([
      { type: 'image_url', image_url: { url: png, detail: 'auto' } },
    ])
  })

  it('keeps surrounding text in order', () => {
    const text = `Screenshot of a.html${encodeToolImageSentinel(png)}tail`
    expect(splitToolImageSentinels(text)).toEqual([
      { type: 'text', text: 'Screenshot of a.html' },
      { type: 'image_url', image_url: { url: png, detail: 'auto' } },
      { type: 'text', text: 'tail' },
    ])
  })

  it('returns null for plain text', () => {
    expect(splitToolImageSentinels('no image here')).toBeNull()
  })

  it('strips sentinels for a model without vision', () => {
    const text = `Screenshot of a.html${encodeToolImageSentinel(png)}`
    expect(stripToolImageSentinels(text, ' (image omitted)')).toBe(
      'Screenshot of a.html (image omitted)'
    )
    expect(stripToolImageSentinels('plain', 'x')).toBe('plain')
  })
})

describe('decodeToolImageSentinelsInBody', () => {
  // Mirrors what `loop.rs` sends on the CLI: a tool message whose content is
  // a text part followed by image_url parts.
  it('turns a sentinel-bearing tool message into content parts', () => {
    const body = {
      messages: [
        { role: 'user', content: 'render it' },
        {
          role: 'tool',
          tool_call_id: 'c1',
          content: `Screenshot of a.html (1280x960)${encodeToolImageSentinel(png)}`,
        },
      ],
    }
    decodeToolImageSentinelsInBody(body)
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'Screenshot of a.html (1280x960)' },
      { type: 'image_url', image_url: { url: png, detail: 'auto' } },
    ])
    expect(body.messages[0].content).toBe('render it')
  })

  it('leaves non-tool roles and plain tool messages alone', () => {
    const user = `user typed${encodeToolImageSentinel(png)}`
    const body = {
      messages: [
        { role: 'user', content: user },
        { role: 'tool', tool_call_id: 'c1', content: 'plain result' },
      ],
    }
    decodeToolImageSentinelsInBody(body)
    expect(body.messages[0].content).toBe(user)
    expect(body.messages[1].content).toBe('plain result')
  })
})

describe('encodeMcpToolImages', () => {
  const b64 = 'iVBORw0KGgo='
  const mcpTool = (output: unknown): UIMessage =>
    ({
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-read_media_file',
          toolCallId: 'c1',
          state: 'output-available',
          input: { path: '/tmp/a.png' },
          output,
        },
      ],
    }) as unknown as UIMessage
  const outputOf = (messages: UIMessage[]) =>
    (messages[0].parts[0] as { output: unknown }).output

  // What the filesystem server's `read_media_file` returns: the image alone.
  it('turns an image-only MCP result into a caption plus a sentinel', () => {
    const out = encodeMcpToolImages([
      mcpTool([{ type: 'image', data: b64, mimeType: 'image/png' }]),
    ])
    const body = {
      messages: [{ role: 'tool', tool_call_id: 'c1', content: outputOf(out) }],
    }
    decodeToolImageSentinelsInBody(body)
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'The tool returned 1 image.' },
      { type: 'image_url', image_url: { url: png, detail: 'auto' } },
    ])
  })

  it('keeps the text items ahead of the images', () => {
    const out = encodeMcpToolImages([
      mcpTool({
        content: [
          { type: 'text', text: 'Rendered frame' },
          { type: 'image', data: b64, mimeType: 'image/png' },
        ],
      }),
    ])
    expect(splitToolImageSentinels(outputOf(out) as string)).toEqual([
      { type: 'text', text: 'Rendered frame' },
      { type: 'image_url', image_url: { url: png, detail: 'auto' } },
    ])
  })

  // The sentinel regex wants a lowercase type and unbroken base64.
  it('normalises wrapped base64 and an upper-case media type', () => {
    const out = encodeMcpToolImages([
      mcpTool([{ type: 'image', data: 'iVBORw0K\nGgo=', mimeType: 'IMAGE/PNG' }]),
    ])
    expect(splitToolImageSentinels(outputOf(out) as string)).toContainEqual({
      type: 'image_url',
      image_url: { url: png, detail: 'auto' },
    })
  })

  it('leaves text-only results and other messages untouched', () => {
    const textOnly = mcpTool([{ type: 'text', text: 'file contents' }])
    const user = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    } as UIMessage
    const out = encodeMcpToolImages([textOnly, user])
    expect(out[0]).toBe(textOnly)
    expect(out[1]).toBe(user)
  })

  it('keeps no base64 once a model without vision strips the sentinel', () => {
    const out = stripUnsupportedImageParts(
      encodeMcpToolImages([
        mcpTool([{ type: 'image', data: b64, mimeType: 'image/png' }]),
      ]),
      false
    )
    expect(outputOf(out)).toBe(
      'The tool returned 1 image. (image omitted: the model has no vision)'
    )
  })
})

describe('toContentToolOutputs', () => {
  const toolMessage = (output: unknown): ModelMessage =>
    ({
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'c1', toolName: 'read_media_file', output },
      ],
    }) as ModelMessage

  // Anthropic, Gemini and OpenAI Responses build their own request shape, so
  // the sentinel cannot be decoded in the fetch: the SDK has to be handed the
  // image as structured `content`, which each provider maps to its own format.
  it('turns a sentinel tool output into text plus an image-data part', () => {
    const [out] = toContentToolOutputs([
      toolMessage({
        type: 'text',
        value: `Rendered frame${encodeToolImageSentinel(png)}`,
      }),
    ])
    expect(out).toEqual(
      toolMessage({
        type: 'content',
        value: [
          { type: 'text', text: 'Rendered frame' },
          { type: 'image-data', data: 'iVBORw0KGgo=', mediaType: 'image/png' },
        ],
      })
    )
  })

  it('leaves plain tool outputs and other roles untouched', () => {
    const plain = toolMessage({ type: 'text', value: 'file contents' })
    const user = { role: 'user', content: 'hi' } as ModelMessage
    const [a, b] = toContentToolOutputs([plain, user])
    expect(a).toBe(plain)
    expect(b).toBe(user)
  })
})
