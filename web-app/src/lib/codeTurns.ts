/* eslint-disable @typescript-eslint/no-explicit-any */
import type { UIMessage } from 'ai'
import type { CodeTurn } from '@/hooks/useCodeSessions'
import { reasoningPartsFromText } from '@/lib/messages'

/**
 * Adapts the code screen's flat `CodeTurn[]` transcript into the AI SDK
 * `UIMessage[]` shape that `MessageItem` (the shared chat renderer) consumes.
 *
 * Grouping: each `user` turn starts a user message; every following
 * `assistant`/`tool` turn folds into a single assistant message (assistant text
 * as reasoning/`text` parts, tool calls as `tool-<name>` parts) until the next user turn —
 * mirroring how one agent turn maps to one assistant message with ordered parts.
 *
 * `diff` has no dedicated slot in the UIMessage tool part, so it is prepended to
 * the tool output as text (per the chosen tradeoff — non-colored).
 */
export function codeTurnsToUIMessages(
  turns: CodeTurn[],
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
      messages.push({
        id: `${idPrefix}-user-${i}`,
        role: 'user',
        parts: [
          { type: 'text', text: turn.content },
          ...(turn.images ?? []).map((url) => ({
            type: 'file',
            url,
            mediaType: url.match(/^data:([^;]+)/)?.[1] ?? 'image/png',
          })),
        ],
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
      // Legacy turns carry only `content`; new turns carry result (+optional diff).
      const body = turn.result ?? turn.content ?? ''
      const output = turn.diff ? `${turn.diff}\n\n${body}` : body
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
