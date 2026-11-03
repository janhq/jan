import { create } from 'zustand'
import type { Attachment } from '@/types/attachment'

/**
 * Recoverable failed drafts, per thread.
 *
 * A submitted draft (text + attachments) whose send was cancelled, failed in
 * attachment processing, or was rejected, while the composer already holds
 * something newer (or another screen is open), lands here as ONE complete unit.
 *
 * This is deliberately NOT the message queue: nothing here is ever sent
 * automatically. An entry leaves only by an explicit user action (Restore draft
 * or Dismiss in ChatInput), so its text can never go out without the
 * attachments it was written for.
 *
 * Memory only. Attachments may carry large media payloads (data URLs), so the
 * store is never persisted; a reload drops the entries, which is the accepted
 * trade-off.
 */
export type FailedDraft = {
  id: string
  text: string
  attachments: Attachment[]
  createdAt: number
}

const EMPTY_DRAFTS: FailedDraft[] = []

let sequence = 0

interface FailedDraftState {
  drafts: Record<string, FailedDraft[]>
  /** Stores a complete draft; returns it. Empty drafts (no text, no files) are ignored. */
  add: (
    threadId: string,
    draft: { text: string; attachments: Attachment[] }
  ) => FailedDraft | undefined
  remove: (threadId: string, id: string) => void
  getDrafts: (threadId: string) => FailedDraft[]
}

export const useFailedDrafts = create<FailedDraftState>((set, get) => ({
  drafts: {},

  add: (threadId, { text, attachments }) => {
    if (!text.trim() && attachments.length === 0) return undefined
    const entry: FailedDraft = {
      id: `failed-draft-${Date.now()}-${++sequence}`,
      text,
      // Snapshot: later edits to the composer bucket must not mutate it.
      attachments: [...attachments],
      createdAt: Date.now(),
    }
    set((state) => ({
      drafts: {
        ...state.drafts,
        [threadId]: [...(state.drafts[threadId] ?? []), entry],
      },
    }))
    return entry
  },

  remove: (threadId, id) => {
    set((state) => {
      const list = state.drafts[threadId]
      if (!list) return state
      const rest = list.filter((d) => d.id !== id)
      if (rest.length === list.length) return state
      const drafts = { ...state.drafts }
      if (rest.length) drafts[threadId] = rest
      else delete drafts[threadId]
      return { drafts }
    })
  },

  getDrafts: (threadId) => get().drafts[threadId] ?? EMPTY_DRAFTS,
}))

export const attachmentIdentity = (a: Attachment) =>
  a.id ?? a.path ?? `${a.type}:${a.name}`

/**
 * Merges restored attachments into a bucket: unique by identity, the restored
 * ones first, and any newer copy or newer file already in the bucket is kept.
 */
export function mergeRestoredAttachments(
  restored: Attachment[],
  prev: Attachment[]
): Attachment[] {
  const current = new Set(prev.map(attachmentIdentity))
  const seen = new Set<string>()
  const merged: Attachment[] = []
  for (const a of restored) {
    const key = attachmentIdentity(a)
    if (current.has(key) || seen.has(key)) continue
    seen.add(key)
    merged.push(a)
  }
  return [...merged, ...prev]
}
