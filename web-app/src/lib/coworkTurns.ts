/* eslint-disable @typescript-eslint/no-explicit-any */
import type { UIMessage } from 'ai'
import type { CoworkTurn } from '@/types/coworkSession'
import { reasoningPartsFromText } from '@/lib/messages'

/** Media ChatInput already serializes on submit (`onSubmit(text, files)`). */
export type ChatMediaFile = {
  type: string
  mediaType: string
  url: string
}

export function imageUrlsFromChatFiles(files?: ChatMediaFile[]): string[] {
  if (!files?.length) return []
  return files
    .filter((file) => file.url && file.mediaType.startsWith('image/'))
    .map((file) => file.url)
}

/**
 * Same shape Chat's thread send uses: a text part (possibly empty) plus
 * each attached file. Empty text is kept so a file-only send still has the
 * part some templates expect as the first user content.
 */
export function userPartsFromCoworkInput(
  text: string,
  files?: ChatMediaFile[]
): Array<
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; url: string }
> {
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; mediaType: string; url: string }
  > = [{ type: 'text', text }]
  for (const file of files ?? []) {
    if (!file.url || !file.mediaType) continue
    parts.push({
      type: 'file',
      mediaType: file.mediaType,
      url: file.url,
    })
  }
  return parts
}

function mediaTypeFromDataUrl(url: string): string {
  const match = /^data:([^;,]+)/.exec(url)
  const type = match?.[1]
  return type && type.startsWith('image/') ? type : 'image/jpeg'
}

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
export function coworkTurnsToUIMessages(
  turns: CoworkTurn[],
  idPrefix = 'code'
): UIMessage[] {
  const messages: UIMessage[] = []
  let assistant: any = null

  const flushAssistant = () => {
    if (assistant && assistant.parts.length > 0) messages.push(assistant)
    assistant = null
  }

  const ensureAssistant = (index: number) => {
    if (!assistant) {
      assistant = { id: `${idPrefix}-asst-${index}`, role: 'assistant', parts: [] }
    }
    return assistant
  }

  turns.forEach((turn, i) => {
    if (turn.role === 'user') {
      flushAssistant()
      const parts: any[] = []
      if (turn.content) {
        parts.push({ type: 'text', text: turn.content })
      }
      for (const url of turn.images ?? []) {
        parts.push({
          type: 'file',
          mediaType: mediaTypeFromDataUrl(url),
          url,
        })
      }
      messages.push({
        id: `${idPrefix}-user-${i}`,
        role: 'user',
        parts: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
      } as any)
      return
    }

    if (turn.role === 'assistant') {
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
    const part: any = {
      type: `tool-${name}`,
      toolCallId: turn.callId ?? `code-tool-${i}`,
      input: turn.args,
      state: running
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
