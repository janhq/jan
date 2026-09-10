import type { ToolUIPart } from 'ai'
import type { ToolOrigin } from './toolOrigin'

/** The call is still being written or executed: no result yet. */
export const isToolRunning = (state: ToolUIPart['state']) =>
  state === 'input-streaming' || state === 'input-available'

/**
 * The chrome a native tool call is presented as: web search reads as a search
 * bar the model types into, web fetch as an address bar.
 */
export type ToolCallBar =
  | { variant: 'search'; query: string; count?: number }
  | { variant: 'address'; url: string }
  | { variant: 'documents'; query: string; count?: number; fileCount?: number }
  /** `bash`, presented as a terminal. `jobId` set = polling a backgrounded run. */
  | { variant: 'terminal'; command: string; jobId?: string }
  /**
   * The workspace tools. `target` is whatever the call is really about -- a path
   * for read/ls, the pattern for find/grep, the entry name for memory/skill --
   * with `detail` carrying the secondary argument when there is one.
   *
   * `body` (a `write`'s file content) and `edits` (an `edit`'s replacement
   * pairs) are the arguments worth showing while they stream: for those two
   * tools the arguments are the work itself, and a large one takes long enough
   * that a spinner says nothing about it.
   */
  | {
      variant: 'workspace'
      tool: string
      target: string
      detail?: string
      body?: string
      edits?: { old_string: string; new_string?: string }[]
    }
  /**
   * `task`. The card answers "which subagent, and what did it just get asked
   * to do" -- how it is getting on belongs to the tasks panel, which follows
   * the child for as long as it runs.
   */
  | { variant: 'subagent'; name: string; task: string }

/**
 * Owned by the RAG extension (extensions/rag-extension/src/tools.ts) and not
 * exported through @janhq/core, so this must stay in sync with it. Only
 * `retrieve` gets a bar; the other RAG tools fall back to the generic card.
 */
export const RAG_RETRIEVE_TOOL = 'retrieve'

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** `edit`'s replacement pairs, from settled arguments or a streaming fragment
 * -- both carry the tool's own shape. A pair whose `new_string` has not arrived
 * is the one being written, and is kept. */
const asEdits = (
  value: unknown
): { old_string: string; new_string?: string }[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const edits = value.flatMap((entry) => {
    const old = (entry as { old_string?: unknown })?.old_string
    if (typeof old !== 'string') return []
    const next = (entry as { new_string?: unknown })?.new_string
    return [
      {
        old_string: old,
        new_string: typeof next === 'string' ? next : undefined,
      },
    ]
  })
  return edits.length > 0 ? edits : undefined
}

/**
 * Build the bar for a native tool call from its arguments. Arguments stream in,
 * so a missing or partial value is normal and renders as an empty/partial bar
 * rather than being suppressed.
 */
export function describeNativeToolCall(
  origin: ToolOrigin | undefined,
  toolName: string,
  input: unknown
): ToolCallBar | undefined {
  if (!origin) return undefined
  const args = (input ?? {}) as Record<string, unknown>
  const asCount = (value: unknown) =>
    typeof value === 'number' ? value : undefined

  if (origin.kind === 'web-search') {
    return {
      variant: 'search',
      query: asString(args.query),
      count: asCount(args.count),
    }
  }
  if (origin.kind === 'web-fetch') {
    return { variant: 'address', url: asString(args.url) }
  }
  if (origin.kind === 'subagent') {
    return {
      variant: 'subagent',
      name: asString(args.subagent_name),
      task: asString(args.description),
    }
  }
  if (origin.kind === 'rag' && toolName === RAG_RETRIEVE_TOOL) {
    return {
      variant: 'documents',
      query: asString(args.query),
      count: asCount(args.top_k),
      fileCount: Array.isArray(args.file_ids)
        ? args.file_ids.length
        : undefined,
    }
  }
  if (origin.kind === 'agent') {
    if (toolName === 'bash') {
      const jobId = asString(args.job_id)
      return {
        variant: 'terminal',
        command: asString(args.command),
        jobId: jobId || undefined,
      }
    }
    // find/grep are about their pattern, with the directory as context; the
    // others are about the single path or name they act on. `ls` defaults to the
    // workspace root, which the widget shows rather than an empty bar.
    if (toolName === 'find' || toolName === 'grep') {
      return {
        variant: 'workspace',
        tool: toolName,
        target: asString(args.pattern),
        detail: asString(args.path) || undefined,
      }
    }
    return {
      variant: 'workspace',
      tool: toolName,
      target: asString(args.path) || asString(args.name),
      body: toolName === 'write' ? asString(args.content) : undefined,
      edits: toolName === 'edit' ? asEdits(args.edits) : undefined,
    }
  }
  return undefined
}

export type BashOutput = {
  /** Combined stdout/stderr with the status and notice lines removed. */
  text: string
  exit?: number
  /** The run was killed by a signal instead of exiting. */
  signaled: boolean
  /** Output exceeded the cap; only the last lines are present. */
  truncated: boolean
  /** The OS sandbox refused something; explains the limits that applied. */
  sandboxNote?: string
}

/** Global: the exit marker is not always last, so every match is considered. */
const EXIT_LINE = /\n?\[exit (-?\d+)\]/g
const SIGNAL_LINE = /\n?\[terminated by signal\]/
const TRUNCATION_NOTICE = /\n?\[output truncated[^\]]*\]/
const SANDBOX_NOTICE = /\n?\[sandbox: ([^\]]*)\]/

/**
 * Split `bash`'s `[exit N]` / `[terminated by signal]` status and its trailing
 * notices off its output (see the tool description in `schema.rs`), so the
 * terminal can show a status of its own instead of leaving markers in the
 * scrollback. Absent or partial markers are normal: the run may still be going.
 *
 * The exit marker is deliberately not anchored to the end of the string. Rust
 * appends the truncation notice and the sandbox hint *after* it, so anchoring
 * would silently lose the exit code exactly when something went wrong.
 */
export function parseBashOutput(output: unknown): BashOutput {
  const text =
    typeof output === 'string'
      ? output
      : typeof (output as { content?: unknown })?.content === 'string'
        ? (output as { content: string }).content
        : ''

  const truncated = TRUNCATION_NOTICE.test(text)
  const signaled = SIGNAL_LINE.test(text)
  const sandboxNote = text.match(SANDBOX_NOTICE)?.[1]
  // The last marker is the real one: a command can echo `[exit 0]` itself.
  const exits = [...text.matchAll(EXIT_LINE)]
  const exitMatch = exits.at(-1)

  let body = exitMatch ? text.slice(0, exitMatch.index) : text
  body = body
    .replace(SIGNAL_LINE, '')
    .replace(TRUNCATION_NOTICE, '')
    .replace(SANDBOX_NOTICE, '')

  return {
    text: body.replace(/\s+$/, ''),
    exit: exitMatch ? Number(exitMatch[1]) : undefined,
    signaled,
    truncated,
    sandboxNote,
  }
}

export type WebFetchPage = {
  title?: string
  url?: string
  content: string
  truncated: boolean
}

const TRUNCATION_MARKER = '\n\n[content truncated]'
const FETCH_HEADER = /^Title: (.*)\nURL: (.*)\n\n([\s\S]*)$/

/**
 * web_fetch returns a plain-text blob prefixed with `Title:` / `URL:` lines
 * (see executeWebTool), not a structured payload. Split it back apart so the
 * page can be presented as a page instead of a wall of text.
 */
export function parseWebFetchOutput(output: unknown): WebFetchPage | undefined {
  const text =
    typeof output === 'string'
      ? output
      : typeof (output as { content?: unknown })?.content === 'string'
        ? (output as { content: string }).content
        : undefined
  if (text === undefined) return undefined

  const truncated = text.endsWith(TRUNCATION_MARKER)
  const body = truncated ? text.slice(0, -TRUNCATION_MARKER.length) : text

  const match = body.match(FETCH_HEADER)
  if (!match) return { content: body, truncated }

  return {
    title: match[1] || undefined,
    url: match[2] || undefined,
    content: match[3],
    truncated,
  }
}
