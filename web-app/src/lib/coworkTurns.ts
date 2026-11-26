/* eslint-disable @typescript-eslint/no-explicit-any */
import type { UIMessage } from 'ai'
import type {
  CoworkAttachedFile,
  CoworkMediaPart,
  CoworkTurn,
} from '@/types/coworkSession'
import { injectFilesIntoPrompt } from '@/lib/fileMetadata'
import { reasoningPartsFromText } from '@/lib/messages'
import { partialToolInput } from '@/lib/partialJson'

/**
 * Adapts the code screen's flat `CoworkTurn[]` transcript into the AI SDK
 * `UIMessage[]` shape that `MessageItem` (the shared chat renderer) consumes.
 *
 * Grouping: each `user` turn starts a user message; every following
 * `assistant`/`tool` turn folds into a single assistant message (assistant text
 * as reasoning/`text` parts, tool calls as `tool-<name>` parts) until the next user turn —
 * mirroring how one agent turn maps to one assistant message with ordered parts.
 *
 * `diff` has no slot on a UIMessage tool part, so it does not travel here at all.
 * It is published to `useToolCallRuntime.diffs` by the caller and rendered as a
 * real coloured diff by `AgentToolWidget`, keyed on `toolCallId`. Folding it into
 * the output text would also corrupt the output the widget parses.
 */
/** The transcript row for a question, with whatever was attached to it. */
export function userTurn(
  text: string,
  media?: CoworkMediaPart[],
  files?: CoworkAttachedFile[]
): CoworkTurn {
  const turn: CoworkTurn = { role: 'user', content: text }
  if (media?.length) turn.media = media
  if (files?.length) turn.files = files
  return turn
}

/**
 * Attached documents ride in the text as an `[ATTACHED_FILES]` block, which is
 * what `MessageItem` already parses into chips for the chat surface; media
 * follow as `file` parts, which it renders as thumbnails.
 */
function userMessageParts(turn: CoworkTurn): unknown[] {
  const text = turn.files?.length
    ? injectFilesIntoPrompt(
        turn.content,
        turn.files.map((f) => ({
          id: f.path,
          name: f.name,
          type: f.fileType,
          size: f.size,
        }))
      )
    : turn.content
  return [{ type: 'text', text }, ...(turn.media ?? [])]
}

/**
 * `indexOffset` is the position of `turns[0]` in the whole transcript, so a
 * slice converted on its own mints the same ids the full transcript would.
 */
export function coworkTurnsToUIMessages(
  turns: CoworkTurn[],
  idPrefix = 'code',
  indexOffset = 0
): UIMessage[] {
  const messages: UIMessage[] = []
  let assistant: any = null

  const flushAssistant = () => {
    if (assistant && assistant.parts.length > 0) messages.push(assistant)
    assistant = null
  }

  const ensureAssistant = (index: number) => {
    if (!assistant) {
      assistant = {
        id: `${idPrefix}-asst-${index}`,
        role: 'assistant',
        parts: [],
      }
    }
    return assistant
  }

  turns.forEach((turn, at) => {
    const i = at + indexOffset
    if (turn.role === 'user') {
      flushAssistant()
      messages.push({
        id: `${idPrefix}-user-${i}`,
        role: 'user',
        parts: userMessageParts(turn),
      } as any)
      return
    }

    // A note from the run, not from either party: it ends the assistant's
    // message for the same reason a question does -- what follows is a reply to
    // it, not a continuation of what came before.
    if (turn.role === 'system') {
      flushAssistant()
      messages.push({
        id: `${idPrefix}-sys-${i}`,
        role: 'system',
        parts: [{ type: 'text', text: turn.content }],
      } as any)
      return
    }

    // Whatever the step finished with (usage, token speed) rides the assistant
    // message its parts fold into, so `MessageItem` renders chat's token-speed
    // popover from the same metadata shape chat persists. A later step
    // overwrites it: the popover describes the newest generation, not the run.
    if (turn.metadata) ensureAssistant(i).metadata = turn.metadata

    if (turn.role === 'assistant') {
      // Natively streamed reasoning rides beside the content (see
      // `CoworkTurn.reasoning`) and becomes a reasoning part ahead of the text,
      // matching emission order.
      if (turn.reasoning) {
        ensureAssistant(i).parts.push({
          type: 'reasoning',
          text: turn.reasoning,
        })
      }
      // Split out <think>/<thought> reasoning into reasoning parts (same helper
      // the chat loader uses) so the agent's chain-of-thought renders in the
      // collapsible reasoning UI instead of leaking into the transcript as text.
      if (turn.content) {
        const asst = ensureAssistant(i)
        for (const part of reasoningPartsFromText(turn.content)) {
          asst.parts.push(part)
        }
      }
      return
    }

    // tool turn -> a `tool-<name>` part on the current assistant message.
    const name = turn.name ?? 'tool'
    const running = turn.status === 'running'
    // Arguments arrive as raw JSON text before the call is complete, so a
    // running turn is read out of that fragment (`input-streaming`). A `write`
    // is the reason: its body *is* the work, and holding the card empty until
    // the last byte lands shows nothing for the whole write.
    const streamed = running && turn.args == null && turn.argsLive
    const part: any = {
      type: `tool-${name}`,
      toolCallId: turn.callId ?? `code-tool-${i}`,
      input: streamed ? partialToolInput(turn.argsLive as string) : turn.args,
      state: streamed
        ? 'input-streaming'
        : running
          ? 'input-available'
          : turn.isError
            ? 'output-error'
            : 'output-available',
    }

    if (!running) {
      // Legacy turns carry only `content`; new turns carry `result`.
      const output = turn.result ?? turn.content ?? ''
      if (turn.isError) {
        part.errorText = output
      } else {
        part.output = output
      }
    }

    ensureAssistant(i).parts.push(part)
  })

  flushAssistant()
  return messages
}

/** A tool part's output as the single string a `tool` row carries. */
function toolResultText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output == null) return ''
  // MCP results: `{ content: [{ type: 'text', text }] }`.
  const content =
    typeof output === 'object' && 'content' in output ? output.content : null
  if (Array.isArray(content)) {
    const texts = content
      .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text as string)
    if (texts.length) return texts.join('\n')
  }
  return JSON.stringify(output)
}

const isToolPart = (part: any): boolean =>
  typeof part?.type === 'string' &&
  (part.type.startsWith('tool-') || part.type === 'dynamic-tool')

/**
 * Ends every tool call a chat left without a result (stopped, or still waiting
 * on approval) as an error. The model must see a result for each call it made,
 * and the task that inherits the conversation will not run the chat's calls.
 */
export function closeUnfinishedToolCalls(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message
    const parts = message.parts as any[]
    if (
      !parts.some(
        (p) =>
          isToolPart(p) &&
          p.state !== 'output-available' &&
          p.state !== 'output-error'
      )
    )
      return message
    return {
      ...message,
      parts: parts.map((p) =>
        isToolPart(p) &&
        p.state !== 'output-available' &&
        p.state !== 'output-error'
          ? {
              ...p,
              state: 'output-error',
              errorText: 'Not run: the chat ended before this call finished.',
            }
          : p
      ),
    } as UIMessage
  })
}

/**
 * The inverse of `coworkTurnsToUIMessages`, for a chat transcript that
 * continues as a task: each message's parts become rows in order. Text and
 * reasoning that precede a tool call share one assistant row, as a run step
 * writes them; the message's metadata rides its first row.
 */
export function uiMessagesToCoworkTurns(messages: UIMessage[]): CoworkTurn[] {
  const turns: CoworkTurn[] = []
  for (const message of messages) {
    const parts = (message.parts ?? []) as any[]
    if (message.role === 'user' || message.role === 'system') {
      const text = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text as string)
        .join('\n')
      const media = parts
        .filter((p) => p.type === 'file' && p.mediaType && p.url)
        .map((p) => ({ type: 'file', mediaType: p.mediaType, url: p.url }))
      turns.push(
        message.role === 'user'
          ? userTurn(text, media as CoworkMediaPart[])
          : { role: 'system', content: text }
      )
      continue
    }
    if (message.role !== 'assistant') continue
    const first = turns.length
    let text = ''
    let reasoning = ''
    const flush = () => {
      if (!text && !reasoning) return
      turns.push({
        role: 'assistant',
        content: text,
        ...(reasoning && { reasoning }),
      })
      text = ''
      reasoning = ''
    }
    for (const part of parts) {
      if (part.type === 'text' && part.text) {
        text += part.text
      } else if (part.type === 'reasoning' && part.text) {
        reasoning += part.text
      } else if (isToolPart(part)) {
        flush()
        const isError = part.state !== 'output-available'
        turns.push({
          role: 'tool',
          content: '',
          callId: part.toolCallId,
          name:
            part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5),
          args: part.input,
          result: isError
            ? (part.errorText ?? '')
            : toolResultText(part.output),
          ...(isError && { isError: true }),
          status: 'done',
        })
      }
    }
    flush()
    if (message.metadata && turns.length > first) {
      turns[first] = {
        ...turns[first],
        metadata: message.metadata as Record<string, unknown>,
      }
    }
  }
  return turns
}

/**
 * The committed transcript followed by the rows a run is still producing.
 *
 * Converting the two separately keeps every committed message's identity across
 * a streamed delta, so `MessageItem`'s memo skips them and a `write` of any
 * size re-renders only the card it is filling. The one seam is a run resumed
 * without a question: its first rows continue the last committed assistant
 * message, so the two are joined here exactly as one conversion would have.
 */
export function appendLiveMessages(
  committed: UIMessage[],
  live: UIMessage[]
): UIMessage[] {
  if (live.length === 0) return committed
  const last = committed.at(-1)
  if (!last || last.role !== 'assistant' || live[0].role !== 'assistant') {
    return [...committed, ...live]
  }
  const joined = { ...last, parts: [...last.parts, ...live[0].parts] }
  return [...committed.slice(0, -1), joined, ...live.slice(1)]
}

/**
 * The index into `appendLiveMessages(committed, live)` where the live tail
 * begins -- the first message that is still mid-run. When the first live
 * message is joined onto the last committed assistant (the same rule
 * `appendLiveMessages` uses), that joined message is mid-run too, so the
 * boundary steps back onto it.
 */
export function liveTailStart(
  committed: UIMessage[],
  live: UIMessage[]
): number {
  if (live.length === 0) return committed.length
  const last = committed.at(-1)
  const joined = last?.role === 'assistant' && live[0]?.role === 'assistant'
  return committed.length - (joined ? 1 : 0)
}
