import { describe, it, expect } from 'vitest'
import { createSSEEventFilter, createCustomFetch } from '../model-factory'

/**
 * Helper: pipe a string through the SSE event filter and collect the output.
 */
async function filterSSE(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input))
      controller.close()
    },
  })

  const filtered = stream.pipeThrough(createSSEEventFilter())
  const reader = filtered.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

describe('createSSEEventFilter', () => {
  it('passes through standard data blocks (no event: field)', async () => {
    const input =
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n'
    const output = await filterSSE(input)
    expect(output).toBe(input)
  })

  it('passes through data blocks with event: message', async () => {
    const input =
      'event: message\ndata: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n'
    const output = await filterSSE(input)
    expect(output).toBe(input)
  })

  it('drops data blocks with custom event types', async () => {
    const custom =
      'event: hermes.tool.progress\ndata: {"tool":"terminal","emoji":"💻","status":"running"}\n\n'
    const standard =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n'
    const output = await filterSSE(custom + standard)
    expect(output).toBe(standard)
  })

  it('drops multiple custom event types while keeping standard ones', async () => {
    const custom1 =
      'event: hermes.tool.progress\ndata: {"tool":"terminal"}\n\n'
    const standard1 =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"A"}}]}\n\n'
    const custom2 =
      'event: heartbeat\ndata: {"ping":true}\n\n'
    const standard2 =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"B"}}]}\n\n'

    const output = await filterSSE(custom1 + standard1 + custom2 + standard2)
    expect(output).toBe(standard1 + standard2)
  })

  it('keeps data: [DONE] blocks', async () => {
    const input =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{}},"finish_reason":"stop"]}\n\n' +
      'data: [DONE]\n\n'
    const output = await filterSSE(input)
    expect(output).toBe(input)
  })

  it('handles chunks split across multiple stream pieces', async () => {
    const encoder = new TextDecoder()
    const part1 =
      'event: hermes.tool.progress\ndata: {"tool":"term'
    const part2 =
      'inal","status":"running"}\n\ndata: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"OK"}}]}\n\n'

    const rs = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(part1))
        controller.enqueue(enc.encode(part2))
        controller.close()
      },
    })

    const reader = rs.pipeThrough(createSSEEventFilter()).getReader()
    let result = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += encoder.decode(value, { stream: true })
    }

    expect(result).toBe(
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"OK"}}]}\n\n'
    )
  })

  it('handles CRLF line endings', async () => {
    const custom =
      'event: hermes.tool.progress\r\ndata: {"tool":"terminal"}\r\n\r\n'
    const standard =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hi"}}]}\r\n\r\n'
    const output = await filterSSE(custom + standard)
    // After CRLF normalization, the filter should have dropped the custom block
    // and kept the standard block (with normalized newlines)
    expect(output).toContain('"content":"Hi"')
    expect(output).not.toContain('hermes.tool.progress')
  })

  it('handles empty event type (passes through)', async () => {
    // An `event:` with an empty value should still pass through
    const input = 'event: \ndata: {"id":"chatcmpl-1","choices":[]}\n\n'
    const output = await filterSSE(input)
    expect(output).toBe(input)
  })

  it('handles event type with extra whitespace', async () => {
    const custom =
      'event:   hermes.tool.progress  \ndata: {"tool":"terminal"}\n\n'
    const standard =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"OK"}}]}\n\n'
    const output = await filterSSE(custom + standard)
    expect(output).toBe(standard)
  })
})

describe('createCustomFetch — SSE event filtering integration', () => {
  function makeSSEFetch(
    sseBody: string,
    headers?: Record<string, string>
  ): typeof globalThis.fetch {
    return (async () =>
      new Response(sseBody, {
        status: 200,
        headers: {
          'content-type': headers?.['content-type'] ?? 'text/event-stream',
          ...headers,
        },
      })) as typeof globalThis.fetch
  }

  it('filters custom events from SSE responses', async () => {
    const custom =
      'event: hermes.tool.progress\ndata: {"tool":"terminal","status":"running"}\n\n'
    const standard =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n'
    const baseFetch = makeSSEFetch(custom + standard)
    const wrapped = createCustomFetch(baseFetch, {}, false)

    const res = await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })

    expect(res.ok).toBe(true)
    const body = await res.text()
    expect(body).not.toContain('hermes.tool.progress')
    expect(body).toContain('"content":"Hello"')
  })

  it('does NOT filter non-SSE responses (e.g. JSON)', async () => {
    const jsonBody = JSON.stringify({
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'Hi' } }],
    })
    const baseFetch = makeSSEFetch(jsonBody, {
      'content-type': 'application/json',
    })
    const wrapped = createCustomFetch(baseFetch, {}, false)

    const res = await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })

    const body = await res.text()
    expect(body).toBe(jsonBody)
  })

  it('passes standard SSE streams through unchanged', async () => {
    const standard =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n' +
      'data: [DONE]\n\n'
    const baseFetch = makeSSEFetch(standard)
    const wrapped = createCustomFetch(baseFetch, {}, false)

    const res = await wrapped('http://test/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })

    const body = await res.text()
    expect(body).toBe(standard)
  })
})
