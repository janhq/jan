import type { UIMessage } from '@ai-sdk/react'

/**
 * What a tool card reads when the turn was stopped before its call finished.
 * It is also what the model is told on the next turn: the call was stopped and
 * its result discarded. Neutral on who stopped it, since Stop is also pressed
 * for the user by the error handling (out of memory, backend or context
 * errors). Only MCP calls are cancelled on the backend; a web, RAG or agent
 * call may still finish its side effects, so this does not claim the call never
 * ran.
 */
export const STOPPED_TOOL_ERROR = 'Stopped before the tool finished.'

/** The part of a tool's result the tool loop reads. */
export type ToolRunResult = { error?: string; content?: unknown }

const isUnsettled = (part: unknown): boolean => {
  const p = part as { type?: string; state?: string } | null
  return (
    !!p &&
    typeof p.type === 'string' &&
    (p.type === 'dynamic-tool' || p.type.startsWith('tool-')) &&
    (p.state === 'input-streaming' || p.state === 'input-available')
  )
}

/**
 * After a Stop nothing will ever resolve a tool call that is still streaming
 * its arguments or waiting to run, so its card would keep saying "Running"
 * (live, and after every reload, once persisted). Settles each such call in one
 * message, the turn that was stopped, as an error and marks that message
 * `stopped`. That is the message with `messageId`, or the last one when none is
 * given. Other messages are history and are never touched.
 *
 * Returns the same array when there is nothing to settle, so callers can tell
 * by identity whether to write anything back.
 */
export function settleStoppedToolCalls(
  messages: UIMessage[],
  messageId?: string
): UIMessage[] {
  const index =
    messageId === undefined
      ? messages.length - 1
      : messages.findIndex((m) => m.id === messageId)
  const message = messages[index]
  if (
    !message ||
    message.role !== 'assistant' ||
    !message.parts?.some(isUnsettled)
  ) {
    return messages
  }
  const settled = {
    ...message,
    parts: message.parts.map((part) =>
      isUnsettled(part)
        ? { ...part, state: 'output-error', errorText: STOPPED_TOOL_ERROR }
        : part
    ),
    metadata: {
      ...((message.metadata as Record<string, unknown> | undefined) ?? {}),
      stopped: true,
    },
  } as UIMessage
  return messages.map((m, i) => (i === index ? settled : m))
}

/**
 * Settles with `promise`, or rejects with an AbortError as soon as `signal`
 * aborts. A tool call that never returns (a runaway shell, a hung MCP server)
 * must not keep the tool loop, and with it the thread, busy after a Stop.
 */
export function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  const aborted = () => new DOMException('Aborted', 'AbortError')
  if (signal.aborted) return Promise.reject(aborted())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}
