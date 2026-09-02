/**
 * Live previews of a file-mutating call whose arguments are still arriving.
 *
 * The `write` window is a port of the TUI's (`starting_call_lines` /
 * `refresh_preview` in `core::cli::tui`). `edit` gets the same treatment for
 * the same reason: for both of them the arguments *are* the work, and a large
 * one takes long enough that a spinner says nothing about it.
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

/** One replacement line, as the sign a diff would give it. */
export type EditRow = { sign: '-' | '+'; text: string }

export type EditPreview = {
  rows: EditRow[]
  /** Rows that scrolled off above the window. */
  skipped: number
}

/**
 * An `edit`'s replacement pairs as a diff, while they are still arriving.
 *
 * Deliberately not the diff that lands when the call finishes: that one is
 * computed against the file by `render_edit_diff` in Rust and knows which lines
 * actually changed and what surrounds them. This has only the arguments, so it
 * shows what is being replaced by what -- every line of `old_string` as a
 * removal, every line of `new_string` as an addition. It is superseded the
 * moment the real diff arrives.
 *
 * Windowed onto the tail for the same reason the write preview is: the newest
 * rows are the ones being written.
 */
export function editPreview(
  edits: { old_string: string; new_string?: string }[]
): EditPreview {
  const all: EditRow[] = []
  for (const edit of edits) {
    for (const text of edit.old_string.split('\n')) all.push({ sign: '-', text })
    if (edit.new_string === undefined) continue
    for (const text of edit.new_string.split('\n')) all.push({ sign: '+', text })
  }
  const rows = all.slice(Math.max(0, all.length - STREAM_TAIL_LINES))
  // The last row is the one still being written.
  const open = rows.length - 1
  return {
    rows: rows.map((row, i) => ({
      ...row,
      text: clampPreviewLine(row.text, i === open),
    })),
    skipped: all.length - rows.length,
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
