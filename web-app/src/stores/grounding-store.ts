import { create } from 'zustand'
import type { RagCitation } from '@/components/Citations'
import {
  computeGrounding,
  type GroundingResult,
} from '@/lib/grounding'

type EmbedFn = (texts: string[]) => Promise<number[][]>

type State = {
  byMessageId: Record<string, GroundingResult>
  computing: Record<string, boolean>
  ensure: (
    messageId: string,
    text: string,
    citations: RagCitation[],
    embed: EmbedFn
  ) => void
}

const fingerprint = (text: string, citations: RagCitation[]) =>
  `${text.length}:${citations.map((c) => c.id).join(',')}`

const lastFp: Record<string, string> = {}
// Monotonic token per message: a multi-tool turn flickers to !isStreaming
// between tool calls, kicking off grounding on partial text while the final
// answer is still streaming. We can't drop the later (full-text) request — its
// result must win — so we tag each run and ignore any stale result that
// resolves after a newer run has started.
const runSeq: Record<string, number> = {}

export const useGroundingStore = create<State>((set) => ({
  byMessageId: {},
  computing: {},

  ensure: (messageId, text, citations, embed) => {
    if (!messageId || !text || !citations.length) return
    const fp = fingerprint(text, citations)
    if (lastFp[messageId] === fp) return

    lastFp[messageId] = fp
    const token = (runSeq[messageId] = (runSeq[messageId] ?? 0) + 1)
    set((s) => ({ computing: { ...s.computing, [messageId]: true } }))

    computeGrounding({ text, citations, embed })
      .then((result) => {
        if (runSeq[messageId] !== token) return
        set((s) => ({
          byMessageId: { ...s.byMessageId, [messageId]: result },
          computing: { ...s.computing, [messageId]: false },
        }))
      })
      .catch(() => {
        if (runSeq[messageId] !== token) return
        set((s) => ({ computing: { ...s.computing, [messageId]: false } }))
      })
  },
}))
