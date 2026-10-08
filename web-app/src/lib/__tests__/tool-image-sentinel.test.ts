import { describe, it, expect } from 'vitest'
import {
  encodeToolImageSentinel,
  hasToolImageSentinel,
  splitToolImageSentinels,
  stripToolImageSentinels,
} from '../tool-image-sentinel'
import { decodeToolImageSentinelsInBody } from '../model-factory'

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
