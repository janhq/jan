/** A skill's summary as returned by `skillList`. */
export interface SkillMeta {
  name: string
  description: string
  user_invocable?: boolean
  model_invocable?: boolean
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

/** What `sessionWorkspaceCopyToThread` did. */
export interface WorkspaceCopy {
  /** False when the session never had a sandbox. */
  copied: boolean
  files: number
  /** Symlinks and special files that were not copied. */
  skipped: number
  /** Entries the copy was not permitted to read; left out, not fatal. */
  unreadable?: number
}

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
 * Every update is terminal (the script matched, or the monitor timed out), so
 * it also closes the monitor; `matched` tells the two apart.
 */
export type MonitorUpdate = {
  monitorId: string
  name: string
  headline: string
  text: string
  matched: boolean
}

/** Who serves a tool call a consent decision is asked for. */
export type ToolOrigin = 'mcp' | 'extension' | 'builtin'

export interface ConsentRequest {
  threadId: string
  callId: string
  tool: string
  server?: string
  origin: ToolOrigin
  /** Ask whatever a grant says, and save nothing from the answer. */
  strict?: boolean
}

/** `allowed` authorizes the one call; `ask` waits for the user's answer. */
export type ConsentVerdict = 'allowed' | 'ask'

export type ConsentAnswer = 'allow-once' | 'allow-thread' | 'allow-always' | 'deny'

/** Configuration-level grants: the only ones saved between launches. */
export interface SavedGrants {
  allowAllMcp: boolean
  /** MCP servers trusted whole. */
  servers: string[]
  /** Tools trusted on their own, by grant key (`mcp:<server>/<tool>`, `<ext server>/<tool>`). */
  tools: string[]
}

export type GrantKind = 'server' | 'tool'
