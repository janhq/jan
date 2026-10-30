import type { Attachment } from '@/types/attachment'

/**
 * First-prompt handoff from the home composer to a new Cowork session.
 *
 * The text goes through sessionStorage (small, survives a reload, the same
 * pattern Chat uses). Media and document attachments can be large, so they are
 * NOT serialized: they travel by session id through an in-memory map, which a
 * reload drops. Chat avoids sessionStorage for media for the same quota reason.
 *
 * Consumption is two-step so a first submit that is refused (no tool-capable
 * model) is not lost: `peek` reads without removing, and the caller `clear`s
 * only once the run was accepted. `claim` guards against the double effect that
 * StrictMode runs in development.
 */

export const COWORK_HANDOFF_PREFIX = 'cowork-initial-message:'

export type CoworkHandoff = {
  text: string
  draft?: string
  files?: Array<{ type: 'file'; mediaType: string; url: string }>
  documents?: Attachment[]
}

type Stored = { text: string; draft?: string }

const attachments = new Map<
  string,
  Pick<CoworkHandoff, 'files' | 'documents'>
>()
const claimed = new Set<string>()

const keyFor = (sessionId: string) => `${COWORK_HANDOFF_PREFIX}${sessionId}`

export function writeCoworkHandoff(sessionId: string, handoff: CoworkHandoff) {
  const stored: Stored = { text: handoff.text, draft: handoff.draft }
  sessionStorage.setItem(keyFor(sessionId), JSON.stringify(stored))
  if (handoff.files?.length || handoff.documents?.length) {
    attachments.set(sessionId, {
      files: handoff.files,
      documents: handoff.documents,
    })
  }
}

export function peekCoworkHandoff(sessionId: string): CoworkHandoff | null {
  const raw = sessionStorage.getItem(keyFor(sessionId))
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as Stored
    if (typeof stored.text !== 'string') return null
    return { ...stored, ...(attachments.get(sessionId) ?? {}) }
  } catch {
    sessionStorage.removeItem(keyFor(sessionId))
    return null
  }
}

/** True exactly once per session id until `clearCoworkHandoff` or a release. */
export function claimCoworkHandoff(sessionId: string): boolean {
  if (claimed.has(sessionId)) return false
  claimed.add(sessionId)
  return true
}

/** Let a refused submit be tried again (e.g. after the user picks a model). */
export function releaseCoworkHandoff(sessionId: string) {
  claimed.delete(sessionId)
}

export function clearCoworkHandoff(sessionId: string) {
  sessionStorage.removeItem(keyFor(sessionId))
  attachments.delete(sessionId)
  claimed.delete(sessionId)
}

/**
 * A handoff for a session that no longer exists (reload before the first
 * commit, session pruned) must not linger: drop it.
 */
export function discardStaleCoworkHandoffs(liveSessionIds: Set<string>) {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i)
    if (!key?.startsWith(COWORK_HANDOFF_PREFIX)) continue
    const id = key.slice(COWORK_HANDOFF_PREFIX.length)
    if (!liveSessionIds.has(id)) clearCoworkHandoff(id)
  }
}
