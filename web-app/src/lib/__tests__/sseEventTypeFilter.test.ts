import { describe, it, expect } from 'vitest'
import {
  SseEventTypeFilter,
  filterDefaultSseEvents,
} from '../sseEventTypeFilter'

const collect = (f: SseEventTypeFilter, chunks: string[]): string => {
  let out = ''
  for (const c of chunks) out += f.process(c)
  out += f.flush()
  return out
}

describe('SseEventTypeFilter', () => {
  it('passes plain data-only frames through unchanged', () => {
    const f = new SseEventTypeFilter()
    const input = 'data: {"choices":[]}\n\ndata: {"choices":[1]}\n\n'
    expect(collect(f, [input])).toBe(input)
  })

  it('drops a named-event frame but keeps the following data frame', () => {
    const f = new SseEventTypeFilter()
    const named =
      'event: hermes.tool.progress\ndata: {"tool":"terminal","status":"running"}\n\n'
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
    expect(collect(f, [named + chunk])).toBe(chunk)
  })

  it('keeps an explicit event: message frame', () => {
    const f = new SseEventTypeFilter()
    const input = 'event: message\ndata: {"choices":[]}\n\n'
    expect(collect(f, [input])).toBe(input)
  })

  it('keeps the [DONE] sentinel frame', () => {
    const f = new SseEventTypeFilter()
    const input = 'data: [DONE]\n\n'
    expect(collect(f, [input])).toBe(input)
  })

  it('keeps keepalive comment frames', () => {
    const f = new SseEventTypeFilter()
    const input = ': ping\n\ndata: {"choices":[]}\n\n'
    expect(collect(f, [input])).toBe(input)
  })

  it('handles a named-event frame split across chunks', () => {
    const f = new SseEventTypeFilter()
    const chunks = [
      'event: hermes.tool',
      '.progress\ndata: {"a":1}',
      '\n\ndata: {"choices":[]}\n\n',
    ]
    expect(collect(f, chunks)).toBe('data: {"choices":[]}\n\n')
  })

  it('handles CRLF frame separators', () => {
    const f = new SseEventTypeFilter()
    const named = 'event: custom\r\ndata: {"x":1}\r\n\r\n'
    const kept = 'data: {"choices":[]}\r\n\r\n'
    expect(collect(f, [named + kept])).toBe(kept)
  })

  it('emits a trailing frame with no terminating separator on flush', () => {
    const f = new SseEventTypeFilter()
    expect(collect(f, ['data: {"choices":[]}'])).toBe('data: {"choices":[]}')
  })

  it('drops a trailing named-event frame with no terminating separator', () => {
    const f = new SseEventTypeFilter()
    expect(collect(f, ['event: custom\ndata: {"x":1}'])).toBe('')
  })
})

describe('filterDefaultSseEvents', () => {
  const read = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
    return out
  }

  const streamOf = (parts: string[]): ReadableStream<Uint8Array> => {
    const enc = new TextEncoder()
    return new ReadableStream({
      start(controller) {
        for (const p of parts) controller.enqueue(enc.encode(p))
        controller.close()
      },
    })
  }

  it('filters named events out of a byte stream', async () => {
    const source = streamOf([
      'event: hermes.tool.progress\ndata: {"tool":"terminal"}\n\n',
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    const out = await read(filterDefaultSseEvents(source))
    expect(out).toBe(
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n'
    )
  })
})
