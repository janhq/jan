import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TextStreamPart, ToolSet } from 'ai'
import {
  SMOOTH_DRAIN_MS,
  SMOOTH_FRAME_MS,
  smoothTextStream,
} from '../smoothTextStream'

type Part = TextStreamPart<ToolSet>

const text = (value: string, id = 't1'): Part =>
  ({ type: 'text-delta', id, text: value }) as Part
const reasoning = (value: string, id = 'r1'): Part =>
  ({ type: 'reasoning-delta', id, text: value }) as Part
const toolCall = (): Part =>
  ({ type: 'tool-call', toolCallId: 'c1', toolName: 'shell', input: {} }) as Part

/**
 * Runs `parts` through the transform, the source closing once they are all
 * written, and returns what came out with the fake time it came out at.
 */
function run(parts: Part[], { keepOpen = false } = {}) {
  const out: Array<{ at: number; part: Part }> = []
  const transform = smoothTextStream()({ tools: {}, stopStream: () => {} })
  const writer = transform.writable.getWriter()
  const reader = transform.readable.getReader()
  let closed = false
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.push({ at: Date.now(), part: value })
    }
    closed = true
  })()
  void (async () => {
    for (const part of parts) await writer.write(part)
    if (!keepOpen) await writer.close()
  })()
  return { out, isClosed: () => closed, writer }
}

const textOf = (out: Array<{ part: Part }>, type = 'text-delta') =>
  out
    .filter((o) => o.part.type === type)
    .map((o) => (o.part as { text: string }).text)
    .join('')

describe('smoothTextStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // A provider that sends a long answer in one go would otherwise put it on
  // screen all at once after a pause.
  it('spreads a burst of text over time instead of showing it at once', async () => {
    const burst = 'a'.repeat(600)
    const { out } = run([text(burst)])

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS / 2)
    const halfway = textOf(out).length
    expect(halfway).toBeGreaterThan(0)
    expect(halfway).toBeLessThan(burst.length)

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS)
    expect(textOf(out)).toBe(burst)
    expect(out.filter((o) => o.part.type === 'text-delta').length).toBeGreaterThan(20)
  })

  it('never falls far behind the model, however much arrives', async () => {
    const burst = 'b'.repeat(20_000)
    const { out } = run([text(burst)])

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS * 1.5)

    expect(textOf(out)).toBe(burst)
  })

  it('lets text that trickles in through at once', async () => {
    const { out } = run([text('Hi')], { keepOpen: true })

    await vi.advanceTimersByTimeAsync(SMOOTH_FRAME_MS * 2)

    expect(textOf(out)).toBe('Hi')
  })

  it('keeps everything else in order, after the text before it', async () => {
    const { out, isClosed } = run([text('x'.repeat(300)), toolCall(), text('after', 't2')])

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS * 2)

    const types = out.map((o) => o.part.type)
    const callAt = types.indexOf('tool-call')
    expect(textOf(out.slice(0, callAt))).toBe('x'.repeat(300))
    expect(textOf(out.slice(callAt))).toBe('after')
    expect(isClosed()).toBe(true)
  })

  it('never splits a character', async () => {
    const value = '日本語の👍🏽テスト👨‍👩‍👧'.repeat(40)
    const { out } = run([text(value)])

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS * 2)

    expect(textOf(out)).toBe(value)
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const o of out) {
      const piece = (o.part as { text: string }).text
      const rejoined = [...segmenter.segment(piece)].map((s) => s.segment).join('')
      expect(rejoined).toBe(piece)
      // Each piece starts on a character boundary of the whole text.
      expect(piece.codePointAt(0)).not.toBe(0xfe0f)
      expect(/^[\u{1F3FB}-\u{1F3FF}‍]/u.test(piece)).toBe(false)
    }
  })

  it('smooths reasoning the same way', async () => {
    const thought = 'think '.repeat(100)
    const { out } = run([reasoning(thought)])

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS / 2)
    expect(textOf(out, 'reasoning-delta').length).toBeLessThan(thought.length)

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS)
    expect(textOf(out, 'reasoning-delta')).toBe(thought)
  })

  it('finishes showing the text before the stream ends', async () => {
    const { out, isClosed } = run([text('z'.repeat(500))])

    await vi.advanceTimersByTimeAsync(SMOOTH_FRAME_MS)
    expect(isClosed()).toBe(false)

    await vi.advanceTimersByTimeAsync(SMOOTH_DRAIN_MS * 2)
    expect(isClosed()).toBe(true)
    expect(textOf(out)).toBe('z'.repeat(500))
  })
})
