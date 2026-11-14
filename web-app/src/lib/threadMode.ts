/**
 * A conversation runs either as a Chat or as a Cowork task. The mode is stored
 * on the thread as `metadata.mode`; absent means chat, so every thread written
 * before Cowork was merged into threads is a chat. The mode only selects the
 * runner: every thread, whatever its mode, uses the thread sandbox.
 */
type ThreadMode = 'chat' | 'cowork'

type WithMetadata =
  | { metadata?: Record<string, unknown> | null }
  | null
  | undefined

export function getThreadMode(thread: WithMetadata): ThreadMode {
  return thread?.metadata?.mode === 'cowork' ? 'cowork' : 'chat'
}

export const isCoworkThread = (thread: WithMetadata): boolean =>
  getThreadMode(thread) === 'cowork'
