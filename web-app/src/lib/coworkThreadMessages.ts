import { ContentType, MessageStatus, ChatCompletionRole } from '@janhq/core'
import type { ThreadContent, ThreadMessage } from '@janhq/core'
import type { CoworkSession } from '@/hooks/useCoworkSessions'
import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import { STOPPED_TOOL_ERROR } from '@/lib/stopped-tool-calls'
import { SYSTEM_NOTICE_KEY, isPingOnly } from '@/lib/coworkPing'

/**
 * Converts a Cowork session's transcript into the records main chat persists
 * in messages.jsonl, so a migrated thread opens with its history.
 *
 * The result is re-sent to providers as the prompt prefix on every turn, so it
 * must be a pure function of the session: ids come from the session id and the
 * message index, timestamps from `session.updated`, tool call ids are the ones
 * the session already holds, and object keys are sorted. Nothing reads the
 * clock or a random source, which is what lets a retried migration rewrite a
 * byte-identical file and keeps the provider's prefix cache valid.
 *
 * The shapes follow `extractContentPartsFromUIMessage` / `toolErrorsOf`
 * (lib/messages.ts), the writer main chat itself uses, with the differences
 * noted inline.
 */

/**
 * Stored when a failed call carries no error text. `convertThreadMessageToUIMessage`
 * reloads a call as an error only when its error text is non-empty, so an
 * empty one would come back as a call that never finished.
 */
export const EMPTY_TOOL_ERROR = 'The tool failed without reporting an error.'

type Part = {
  type?: unknown
  text?: unknown
  reasoning?: unknown
  mediaType?: unknown
  url?: unknown
  toolCallId?: unknown
  toolName?: unknown
  state?: unknown
  input?: unknown
  output?: unknown
  errorText?: unknown
}

type SourceMessage = {
  role?: unknown
  parts?: Part[]
  metadata?: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Recursively sorts object keys and drops `undefined`, as JSON would. */
function stable<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stable) as T
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = stable(value[key])
    }
    return out as T
  }
  return value
}

/** Cowork stores `updated` in ms, older data in seconds; threads want ms here. */
const updatedMs = (updated: number | undefined) => {
  // A session with no usable `updated` is dated 0: NaN would be stored as null.
  if (typeof updated !== 'number' || !Number.isFinite(updated)) return 0
  return updated > 1e12 ? updated : updated * 1000
}

const textItem = (type: ContentType, value: string): ThreadContent => ({
  type,
  text: { value, annotations: [] },
})

/** The base64 payload of a data URL, or the url itself when it is not one. */
const dataOf = (url: string) =>
  url.startsWith('data:') ? url.slice(url.indexOf(',') + 1) : url

function fileItem(part: Part): ThreadContent | null {
  if (typeof part.mediaType !== 'string' || typeof part.url !== 'string') {
    return null
  }
  const { mediaType, url } = part
  if (mediaType.startsWith('image/')) {
    return {
      type: ContentType.Image,
      image_url: { url, detail: 'auto' },
    }
  }
  if (mediaType === 'audio/wav' || mediaType === 'audio/mpeg') {
    return {
      type: ContentType.InputAudio,
      input_audio: {
        data: dataOf(url),
        format: mediaType === 'audio/wav' ? 'wav' : 'mp3',
      },
    }
  }
  if (mediaType.startsWith('video/')) {
    return {
      type: ContentType.InputVideo,
      input_video: { data: dataOf(url), format: mediaType },
    }
  }
  // Main chat has no content type for other files either; it drops them too.
  return null
}

function toolName(part: Part): string | null {
  if (typeof part.type !== 'string') return null
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : null
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
}

/**
 * Cowork can end a run with a call that never got a result (stopped, crashed).
 * Providers reject a call without a result, and main chat's own Stop settles
 * such a call as an error, so the migration does the same.
 */
function convertMessage(
  source: SourceMessage,
  sessionId: string,
  index: number,
  usedCallIds: Set<string>
): { content: ThreadContent[]; toolErrors: Record<string, string> } {
  const content: ThreadContent[] = []
  const toolErrors: Record<string, string> = {}

  ;(source.parts ?? []).forEach((part, partIndex) => {
    if (!isRecord(part)) return
    if (part.type === 'text') {
      if (typeof part.text === 'string' && part.text) {
        content.push(textItem(ContentType.Text, part.text))
      }
      return
    }
    if (part.type === 'reasoning') {
      // Same order as extractContentPartsFromUIMessage.
      const text = part.reasoning ?? part.text
      if (typeof text === 'string' && text) {
        content.push(textItem(ContentType.Reasoning, text))
      }
      return
    }
    if (part.type === 'file') {
      const item = fileItem(part)
      if (item) content.push(item)
      return
    }

    const name = toolName(part)
    if (name === null) return
    // A reused or missing id would pair two calls with one result, so it is
    // replaced by an id that depends only on where the call sits.
    const given = typeof part.toolCallId === 'string' ? part.toolCallId : ''
    const id =
      given && !usedCallIds.has(given)
        ? given
        : `${sessionId}-call-${index}-${partIndex}`
    usedCallIds.add(id)

    const item: ThreadContent = {
      type: ContentType.ToolCall,
      tool_call_id: id,
      tool_name: name,
      ...(part.input !== undefined && { input: part.input }),
    }
    if (part.state === 'output-available') {
      // Not `part.output || ...`: an empty output is still a result.
      item.output = part.output ?? ''
    } else if (part.state === 'output-error') {
      toolErrors[id] =
        typeof part.errorText === 'string' && part.errorText
          ? part.errorText
          : EMPTY_TOOL_ERROR
    } else {
      toolErrors[id] = STOPPED_TOOL_ERROR
    }
    content.push(item)
  })

  return { content, toolErrors }
}

export type ThreadMessagesOptions = {
  /**
   * Anchor for `created_at`, in ms: message `i` is stamped `anchorMs + i`.
   * Without it the stamps end at `session.updated`, which is right for a
   * one-shot conversion but moves EVERY message each time the session is
   * updated. A live session that is re-converted on each turn passes its
   * thread's immutable `created` here, so the stamps of the messages already
   * written never change when one is appended and the replayed prompt prefix
   * stays byte-identical.
   */
  anchorMs?: number
}

/**
 * The anchor a one-shot conversion of `session` uses (see `anchorMs`). The
 * migration stamped its messages with it, so a live session that adopts a
 * migrated thread keeps those exact stamps by reusing it. `updatedOverrideMs`
 * is the exact `updated` the migration saw (its record keeps it in
 * `metadata.migratedFrom.updated`; the thread's own `updated` is only seconds).
 */
export function defaultAnchorMs(
  session: CoworkSession,
  updatedOverrideMs?: number
): number {
  const length = session.messages?.length
    ? session.messages.length
    : coworkTurnsToUIMessages(session.turns ?? [], session.id).length
  return updatedMs(updatedOverrideMs ?? session.updated) - (length - 1)
}

export function coworkSessionToThreadMessages(
  session: CoworkSession,
  options: ThreadMessagesOptions = {}
): ThreadMessage[] {
  const source: SourceMessage[] = (
    session.messages?.length
      ? session.messages
      : coworkTurnsToUIMessages(session.turns ?? [], session.id)
  ) as unknown as SourceMessage[]

  // Strictly increasing and ending at the last update, so the order survives
  // the sort-by-created_at main chat applies when it merges stored messages.
  const base =
    options.anchorMs !== undefined && Number.isFinite(options.anchorMs)
      ? options.anchorMs
      : updatedMs(session.updated) - (source.length - 1)
  const usedCallIds = new Set<string>()
  const out: ThreadMessage[] = []

  source.forEach((message, index) => {
    // A system row is a display note; the model saw it as a user ping that is
    // already in `messages`. A system message mid-history breaks providers.
    if (message.role !== 'user' && message.role !== 'assistant') return
    const { content, toolErrors } = convertMessage(
      message,
      session.id,
      index,
      usedCallIds
    )
    if (content.length === 0) return

    // toolErrors is derived from the parts alone: a stale one in the source
    // metadata would mark a call that has a result as failed.
    const sourceMetadata: Record<string, unknown> = isRecord(message.metadata)
      ? { ...message.metadata }
      : {}
    delete sourceMetadata.toolErrors
    delete sourceMetadata[SYSTEM_NOTICE_KEY]
    const metadata = {
      ...sourceMetadata,
      ...(Object.keys(toolErrors).length > 0 && { toolErrors }),
      // A ping (`<SYSTEM>...</SYSTEM>`, a subagent finishing) is in the model's
      // history as a user turn, so it is kept as one with its text unchanged
      // and only flagged; main chat then shows it as a system note instead of
      // a raw user bubble. Dropping it would change what the model is replayed.
      ...(isPingOnly({ role: String(message.role), parts: message.parts }) && {
        [SYSTEM_NOTICE_KEY]: true,
      }),
    }
    const createdAt = base + index
    out.push(
      stable({
        type: 'text',
        role:
          message.role === 'user'
            ? ChatCompletionRole.User
            : ChatCompletionRole.Assistant,
        content,
        id: `${session.id}-msg-${index}`,
        object: 'thread.message',
        thread_id: session.id,
        status: MessageStatus.Ready,
        created_at: createdAt,
        completed_at: createdAt,
        ...(Object.keys(metadata).length > 0 && { metadata }),
      })
    )
  })
  return out
}
