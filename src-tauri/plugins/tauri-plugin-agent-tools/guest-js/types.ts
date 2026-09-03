/** A skill's summary as returned by `skillList`. */
export interface SkillMeta {
  name: string
  description: string
}

/** An image a tool returned, as a `data:` URL plus its display name. */
export interface ToolImage {
  dataUrl: string
  name: string
}

/** Outcome of a built-in tool execution. */
export interface ToolResult {
  content: string
  /** Display-only diff for write/edit; never part of model context. */
  diff: string | null
  isError: boolean
  /** Present when the tool returned images (`read` of an image, `screenshot`). */
  images?: ToolImage[]
}

/**
 * An OpenAI-shaped function schema for a built-in tool, as produced by the
 * plugin's `schema.rs` (the single source of truth).
 */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * One memory-catalog row: enough to advertise a note without its body.
 * `mtimeMs` is Unix millis (0 when the filesystem withholds it), so callers can
 * keep the newest notes when they cannot keep them all.
 */
export interface MemoryCatalogEntry {
  name: string
  summary: string
  mtimeMs: number
}

/** Which sandbox namespace an id belongs to. */
export type WorkspaceScope = 'thread' | 'session'

/** One fragment of a tool's live output. */
export type ToolOutputChunk = {
  /** Monotonic per call, so a receiver can assert ordering. */
  seq: number
  /** The tool call this belongs to; a backgrounded `bash` needs it. */
  callId: string | null
  text: string
}

/**
 * One monitor notice, in the two registers a background ping needs: `headline`
 * for the transcript row, `text` for the `<SYSTEM>` reminder the model gets.
 * `done` marks the update that also ends the monitor (all met, or timeout).
 */
export type MonitorUpdate = {
  monitorId: string
  headline: string
  text: string
  done: boolean
}
