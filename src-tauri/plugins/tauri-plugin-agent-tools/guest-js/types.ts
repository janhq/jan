/** A skill's summary as returned by `skillList`. */
export interface SkillMeta {
  name: string
  description: string
}

/** Outcome of a built-in tool execution. */
export interface ToolResult {
  content: string
  /** Display-only diff for write/edit; never part of model context. */
  diff: string | null
  isError: boolean
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
