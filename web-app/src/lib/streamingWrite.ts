/**
 * The live preview of a `write` whose body is still arriving.
 *
 * Port of the TUI's streaming-write window (`starting_call_lines` /
 * `refresh_preview` in `core::cli::tui`). A file write is the one tool call
 * whose arguments are worth watching: they are the work, and a large one takes
 * long enough that a spinner says nothing.
 */

/** Trailing lines kept on screen. Enough to see the write progressing without
 * the preview owning the transcript. */
export const STREAM_TAIL_LINES = 12

/**
 * Longest line kept. Minified content (a bundle, a JSON blob) is one line that
 * grows for the whole write, and the cost of rendering it grows with it -- on
 * every delta. Wide enough that nothing a user could have read is dropped.
 */
export const STREAM_MAX_LINE_CHARS = 300

/** Marks a line the clamp cut. */
const ELLIPSIS = '…'

export type WritePreview = {
  /** The window, oldest first. */
  lines: string[]
  /** Lines that scrolled off above it, so the gutter can number the rest. */
  skipped: number
}

/**
 * The last [`STREAM_TAIL_LINES`] lines of `body`.
 *
 * Split on `\n` rather than by lines so a trailing newline shows as the empty
 * line the model just opened -- that is where the next content lands, and
 * dropping it makes the preview look stalled.
 */
export function writeTail(body: string): WritePreview {
  const all = body.split('\n')
  const lines = all.slice(Math.max(0, all.length - STREAM_TAIL_LINES))
  // The last line is the one still being written; the rest are finished.
  const open = lines.length - 1
  return {
    lines: lines.map((line, i) => clampPreviewLine(line, i === open)),
    skipped: all.length - lines.length,
  }
}

/**
 * Clamp one preview line, marking it where it was cut.
 *
 * `open` marks the line still being written, which keeps its *tail*: that is
 * where new bytes land, so it is the end that shows the write progressing. A
 * finished line keeps its head, where it reads from.
 */
function clampPreviewLine(line: string, open: boolean): string {
  const chars = [...line]
  if (chars.length <= STREAM_MAX_LINE_CHARS) return line
  return open
    ? ELLIPSIS + chars.slice(chars.length - STREAM_MAX_LINE_CHARS).join('')
    : chars.slice(0, STREAM_MAX_LINE_CHARS).join('') + ELLIPSIS
}
