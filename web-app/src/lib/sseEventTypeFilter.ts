/**
 * W3C-compliant SSE event-type filtering for OpenAI-compatible streams.
 *
 * The Vercel AI SDK's `parseJsonEventStream` destructures only the `data:`
 * field of each SSE event and discards the `event:` type, then validates every
 * payload against the `chat.completion.chunk` schema. Servers that interleave
 * custom named events (e.g. `event: hermes.tool.progress`) therefore trip a
 * fatal "Type validation failed" and the whole stream aborts.
 *
 * Per the SSE spec an event's type defaults to "message"; a client with no
 * handler for other types must ignore them. This filter drops every frame
 * whose event type is not the default before the SDK ever parses it.
 */

const FRAME_SEPARATOR = /\r\n\r\n|\n\n|\r\r/

/** Returns the frame's SSE event type, defaulting to "message". */
function eventTypeOf(frame: string): string {
  let type = 'message'
  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (!line.startsWith('event:')) continue
    let value = line.slice('event:'.length)
    if (value.startsWith(' ')) value = value.slice(1)
    // An empty event field dispatches as "message" per spec.
    type = value === '' ? 'message' : value
  }
  return type
}

const isDefaultEvent = (frame: string): boolean =>
  eventTypeOf(frame) === 'message'

/**
 * Stateful, chunk-boundary-safe filter over the raw SSE text. Feed decoded
 * string chunks to `process()`; call `flush()` once at stream end to emit any
 * trailing frame that never received a terminating blank line.
 */
export class SseEventTypeFilter {
  private buffer = ''

  process(chunk: string): string {
    this.buffer += chunk
    let out = ''
    for (;;) {
      const match = FRAME_SEPARATOR.exec(this.buffer)
      if (!match) break
      const end = match.index + match[0].length
      const frame = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end)
      if (isDefaultEvent(frame)) out += frame
    }
    return out
  }

  flush(): string {
    if (!this.buffer) return ''
    const frame = this.buffer
    this.buffer = ''
    return isDefaultEvent(frame) ? frame : ''
  }
}

/** Wraps an SSE byte stream, dropping any non-default (named) event frames. */
export function filterDefaultSseEvents(
  body: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const filter = new SseEventTypeFilter()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const emit = (text: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (text) controller.enqueue(encoder.encode(text))
  }
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        emit(filter.process(decoder.decode(chunk, { stream: true })), controller)
      },
      flush(controller) {
        emit(filter.process(decoder.decode()), controller)
        emit(filter.flush(), controller)
      },
    })
  )
}
