import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai'

/** One screen frame: how often buffered text is let out. */
export const SMOOTH_FRAME_MS = 16
/** How long text may wait before it is on screen. */
export const SMOOTH_DRAIN_MS = 1_000

type Part = TextStreamPart<ToolSet>
type Delta = Extract<Part, { type: 'text-delta' | 'reasoning-delta' }>

type Queued =
  | { kind: 'delta'; part: Delta; chars: string[]; pos: number; arrivedAt: number }
  | { kind: 'other'; part: Part }

const isDelta = (part: Part): part is Delta =>
  part.type === 'text-delta' || part.type === 'reasoning-delta'

// Intl.Segmenter (ES2022) is in every webview Jan runs in, but not in the
// project's TypeScript lib, so only the part used here is typed.
type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> }
const SegmenterCtor = (
  Intl as unknown as {
    Segmenter?: new (
      locale: string | undefined,
      options: { granularity: 'grapheme' }
    ) => GraphemeSegmenter
  }
).Segmenter
const segmenter = SegmenterCtor
  ? new SegmenterCtor(undefined, { granularity: 'grapheme' })
  : undefined

/** User-perceived characters, so no emoji or combined character is split. */
const charactersOf = (text: string): string[] =>
  segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)

/**
 * Let text and reasoning out at a steady pace, a few characters a frame,
 * rather than as the bursts a provider sends: a reply that arrives in large
 * pieces with long pauses between them then reads as continuous progress.
 *
 * Text is never held back for longer than SMOOTH_DRAIN_MS: the pace speeds up
 * with how much is waiting, so the first waiting character is on screen by
 * then. Everything that is not text (tool calls, step ends) comes out in its
 * original order, once the text before it is out, and the stream ends only
 * when all text has been let out.
 */
export function smoothTextStream(): StreamTextTransform<ToolSet> {
  return () => {
    let controller: TransformStreamDefaultController<Part> | undefined
    const queue: Queued[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let drained: (() => void) | undefined

    const waitingChars = () =>
      queue.reduce(
        (sum, item) => sum + (item.kind === 'delta' ? item.chars.length - item.pos : 0),
        0
      )

    const emit = (part: Part) => {
      try {
        controller?.enqueue(part)
      } catch {
        // The reader went away (the request was stopped): nothing to show.
        queue.length = 0
      }
    }

    const tick = () => {
      timer = undefined
      const head = queue.find((item) => item.kind === 'delta')
      const framesLeft = head
        ? Math.max(1, Math.floor((head.arrivedAt + SMOOTH_DRAIN_MS - Date.now()) / SMOOTH_FRAME_MS))
        : 1
      let budget = Math.max(1, Math.ceil(waitingChars() / framesLeft))

      while (queue.length > 0) {
        const item = queue[0]
        if (item.kind === 'other') {
          emit(item.part)
          queue.shift()
          continue
        }
        if (budget === 0) break
        const take = Math.min(budget, item.chars.length - item.pos)
        if (take > 0) {
          emit({ ...item.part, text: item.chars.slice(item.pos, item.pos + take).join('') })
        }
        item.pos += take
        budget -= take
        if (item.pos >= item.chars.length) queue.shift()
      }

      if (queue.length > 0) {
        timer = setTimeout(tick, SMOOTH_FRAME_MS)
      } else {
        drained?.()
        drained = undefined
      }
    }

    const start = () => {
      if (timer === undefined) tick()
    }

    return new TransformStream<Part, Part>({
      start(c) {
        controller = c
      },
      transform(part) {
        if (isDelta(part)) {
          const chars = charactersOf(part.text)
          if (chars.length === 0) return
          queue.push({ kind: 'delta', part, chars, pos: 0, arrivedAt: Date.now() })
        } else {
          queue.push({ kind: 'other', part })
        }
        start()
      },
      flush() {
        if (queue.length === 0) return
        return new Promise<void>((resolve) => {
          drained = resolve
          start()
        })
      },
    })
  }
}
