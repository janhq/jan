import type { UIMessage } from 'ai'

/**
 * Out-of-band notes folded into a Cowork conversation: today, a backgrounded
 * subagent reporting that it finished.
 *
 * Two problems this owns, the same two the Rust `reminder` module owns.
 *
 * It is marked with `<SYSTEM>` so the model can tell it from user-authored text,
 * and so anything that enumerates user *turns* -- rewind, and the transcript it
 * has to stay in step with -- can skip a message that only exists to carry one.
 *
 * And it is folded into the trailing message rather than pushed as its own
 * whenever that message is the user's own, unanswered: consecutive user
 * messages are rejected outright by some providers, and two children finishing
 * together is the normal case.
 *
 * Kept free of every other import so the session store can use the predicate
 * without pulling the runner (and the plugin API behind it) into its graph.
 */

export const PING_OPEN = '<SYSTEM>'
export const PING_CLOSE = '</SYSTEM>'

/**
 * Metadata flag on a stored message that is a ping and should be shown as a
 * system note. The Cowork-to-threads migration sets it: the message stays a
 * `user` message with its text untouched, because that is what the model was
 * sent. A real `role: 'system'` row in the middle of a replayed history is
 * turned into a system turn by `convertToModelMessages`, which some providers
 * reject, and it would change the prompt prefix.
 */
export const SYSTEM_NOTICE_KEY = 'systemNotice'

/** True when a (stored or UI) message is flagged to render as a system note. */
export function isSystemNotice(message: { metadata?: unknown }): boolean {
  const meta = message.metadata
  return (
    typeof meta === 'object' &&
    meta !== null &&
    (meta as Record<string, unknown>)[SYSTEM_NOTICE_KEY] === true
  )
}

/** True when a message carries pings and nothing the user typed. */
export function isPingOnly(message: { role: string; parts?: unknown }): boolean {
  if (message.role !== 'user') return false
  const parts = (message.parts ?? []) as Array<{ type?: string; text?: string }>
  const texts = parts.filter((p) => p.type === 'text')
  return (
    texts.length > 0 &&
    texts.every((p) => (p.text ?? '').trim().startsWith(PING_OPEN))
  )
}

/** Fold pings into `messages` as one marked user turn. */
export function attachPings(messages: UIMessage[], pings: string[]): void {
  if (pings.length === 0) return
  const text = `${PING_OPEN}\n${pings.join('\n')}\n${PING_CLOSE}`
  const last = messages[messages.length - 1]
  if (last?.role === 'user') {
    const parts = last.parts as Array<{ type: string; text: string }>
    parts.push({ type: 'text', text })
    return
  }
  messages.push({
    id: `ping-${messages.length}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  } as UIMessage)
}
