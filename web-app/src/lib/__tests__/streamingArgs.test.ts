import { describe, it, expect } from 'vitest'
import {
  editPreview,
  writeTail,
  STREAM_TAIL_LINES,
  STREAM_MAX_LINE_CHARS,
} from '../streamingArgs'

describe('writeTail', () => {
  it('keeps a short body whole', () => {
    expect(writeTail('a\nb\nc')).toEqual({ lines: ['a', 'b', 'c'], skipped: 0 })
  })

  it('windows a long body onto its tail, counting what scrolled off', () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
      '\n'
    )
    const { lines, skipped } = writeTail(body)
    expect(lines).toHaveLength(STREAM_TAIL_LINES)
    expect(skipped).toBe(20 - STREAM_TAIL_LINES)
    // Numbered from `skipped`, so line 9 is where the window starts.
    expect(lines[0]).toBe(`line ${skipped + 1}`)
    expect(lines.at(-1)).toBe('line 20')
  })

  /// Split on `\n`, not by lines: a trailing newline is the empty line the
  /// model just opened, and dropping it makes the preview look stalled.
  it('shows the empty line a trailing newline opened', () => {
    expect(writeTail('a\n').lines).toEqual(['a', ''])
  })

  /// Minified content is one line that grows for the whole write, and the cost
  /// of rendering it grows with it -- on every delta.
  it('clamps the open line to its tail, where the new bytes land', () => {
    const open = 'x'.repeat(STREAM_MAX_LINE_CHARS + 50) + 'END'
    const { lines } = writeTail(`done\n${open}`)
    expect(lines[1].startsWith('…')).toBe(true)
    expect(lines[1].endsWith('END')).toBe(true)
    expect([...lines[1]]).toHaveLength(STREAM_MAX_LINE_CHARS + 1)
  })

  /// A finished line keeps its head, which is where it reads from.
  it('clamps a finished line to its head', () => {
    const long = 'START' + 'y'.repeat(STREAM_MAX_LINE_CHARS + 50)
    const { lines } = writeTail(`${long}\nopen`)
    expect(lines[0].startsWith('START')).toBe(true)
    expect(lines[0].endsWith('…')).toBe(true)
    expect([...lines[0]]).toHaveLength(STREAM_MAX_LINE_CHARS + 1)
  })

  /// The budget is in characters, not bytes: a line of multi-byte text is no
  /// wider on screen than the same number of ASCII ones.
  it('counts characters, not bytes, when clamping', () => {
    const e = '\u00e9'
    expect(writeTail(e.repeat(STREAM_MAX_LINE_CHARS)).lines[0]).not.toContain(
      '\u2026'
    )
    expect(writeTail(e.repeat(STREAM_MAX_LINE_CHARS + 1)).lines[0]).toContain(
      '\u2026'
    )
  })
})

describe('editPreview', () => {
  it('reads as a diff: what goes out, then what comes in', () => {
    const { rows, skipped } = editPreview([
      { old_string: 'a\nb', new_string: 'A' },
    ])
    expect(rows).toEqual([
      { sign: '-', text: 'a' },
      { sign: '-', text: 'b' },
      { sign: '+', text: 'A' },
    ])
    expect(skipped).toBe(0)
  })

  /// The pair with no replacement yet is the one being written, which is
  /// exactly the one worth watching.
  it('keeps a pair whose replacement has not arrived', () => {
    const { rows } = editPreview([
      { old_string: 'one', new_string: '1' },
      { old_string: 'two' },
    ])
    expect(rows.map((r) => r.sign)).toEqual(['-', '+', '-'])
    expect(rows.at(-1)).toEqual({ sign: '-', text: 'two' })
  })

  it('windows onto the tail, where the writing is', () => {
    const edits = Array.from({ length: 10 }, (_, i) => ({
      old_string: `old ${i}`,
      new_string: `new ${i}`,
    }))
    const { rows, skipped } = editPreview(edits)
    expect(rows).toHaveLength(STREAM_TAIL_LINES)
    expect(skipped).toBe(20 - STREAM_TAIL_LINES)
    expect(rows.at(-1)).toEqual({ sign: '+', text: 'new 9' })
  })

  it('clamps a long replacement the same way a write body is clamped', () => {
    const { rows } = editPreview([
      { old_string: 'x', new_string: 'y'.repeat(STREAM_MAX_LINE_CHARS + 5) },
    ])
    expect([...rows[1].text]).toHaveLength(STREAM_MAX_LINE_CHARS + 1)
  })

  it('has nothing to show before the first pair', () => {
    expect(editPreview([])).toEqual({ rows: [], skipped: 0 })
  })
})

describe('writeTail windowing', () => {
  const bySplit = (body: string) => {
    const all = body.split('\n')
    const lines = all.slice(Math.max(0, all.length - STREAM_TAIL_LINES))
    return { lines, skipped: all.length - lines.length }
  }

  it('matches a whole-body split for every window shape', () => {
    const bodies = [
      '',
      '\n',
      'a',
      'a\n',
      '\n'.repeat(STREAM_TAIL_LINES - 1),
      '\n'.repeat(STREAM_TAIL_LINES),
      '\n'.repeat(STREAM_TAIL_LINES + 1),
      '\n' + 'x\n'.repeat(STREAM_TAIL_LINES),
      Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
      Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n',
    ]
    for (const body of bodies) {
      expect(writeTail(body), JSON.stringify(body)).toEqual(bySplit(body))
    }
  })
})
