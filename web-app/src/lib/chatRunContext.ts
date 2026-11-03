import type { UIMessage } from 'ai'
import { PING_OPEN, PING_CLOSE } from './coworkPing'
import { truncateUtf16 } from './truncateUtf16'

/**
 * `data-run-context` UI part: the pings (finished subagents, monitor events)
 * a Chat run's inbox drained mid-run, persisted with the assistant turn at the
 * point they arrived. The live run replays them to the model from its own
 * canonical history; on reload, `expandChatRunContext` turns the persisted
 * parts back into the same marked user turns. The part is never rendered
 * (unknown `data-*` parts are ignored, like `data-task-status`).
 */
export const RUN_CONTEXT_PART = 'data-run-context'

/** Upper bound (chars) of the text one part carries. */
export const RUN_CONTEXT_MAX_CHARS = 8192

/** Appended when a single ping exceeds the bound (counted inside the bound). */
export const RUN_CONTEXT_TRUNCATION_MARKER = `\n\n[truncated: notice exceeded ${RUN_CONTEXT_MAX_CHARS} characters]`

/** The canonical bounded text of ONE ping: at most RUN_CONTEXT_MAX_CHARS UTF-16
 * units, marker included, never cut inside a surrogate pair. The live replay and
 * the persisted `data-run-context` part both use exactly this text. */
export function boundRunContextText(text: string): string {
  return truncateUtf16(text, RUN_CONTEXT_MAX_CHARS, RUN_CONTEXT_TRUNCATION_MARKER)
}

/** The marked user turn a ping is replayed to the model as (live and reload). */
export function runContextPingMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text: `${PING_OPEN}\n${text}\n${PING_CLOSE}` }] } as UIMessage
}

/** Whether `data` is exactly `{ text: <non-empty string within the bound> }`. */
export function isRunContextData(data: unknown): data is { text: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const keys = Object.keys(data)
  const text = (data as { text?: unknown }).text
  return (
    keys.length === 1 &&
    keys[0] === 'text' &&
    typeof text === 'string' &&
    text.length > 0 &&
    text.length <= RUN_CONTEXT_MAX_CHARS
  )
}

/**
 * Pure. Splits each assistant message at its `data-run-context` parts into
 * assistant segments with a marked user ping message between them, preserving
 * order, and strips the data parts. Messages without such a part are returned
 * by reference. Invalid parts are dropped, never replayed.
 */
export function expandChatRunContext(messages: UIMessage[]): UIMessage[] {
  const out: UIMessage[] = []
  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : []
    if (message.role !== 'assistant' || !parts.some((p) => p.type === RUN_CONTEXT_PART)) {
      out.push(message)
      continue
    }
    let segment: UIMessage['parts'] = []
    let segments = 0
    let pings = 0
    const flush = () => {
      if (segment.length === 0) return
      out.push({ ...message, id: `${message.id}_r${segments++}`, parts: segment })
      segment = []
    }
    for (const part of parts) {
      if (part.type !== RUN_CONTEXT_PART) {
        segment.push(part)
        continue
      }
      const data = (part as { data?: unknown }).data
      if (!isRunContextData(data)) continue
      flush()
      out.push(runContextPingMessage(`${message.id}_ctx${pings++}`, data.text))
    }
    flush()
  }
  return out
}
