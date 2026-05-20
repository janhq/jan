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

export const useGroundingStore = create<State>((set, get) => ({
  byMessageId: {},
  computing: {},

  ensure: (messageId, text, citations, embed) => {
    if (!messageId || !text || !citations.length) return
    const fp = fingerprint(text, citations)
    if (lastFp[messageId] === fp) return
    if (get().computing[messageId]) return

    lastFp[messageId] = fp
    set((s) => ({ computing: { ...s.computing, [messageId]: true } }))

    computeGrounding({ text, citations, embed })
      .then((result) => {
        set((s) => ({
          byMessageId: { ...s.byMessageId, [messageId]: result },
          computing: { ...s.computing, [messageId]: false },
        }))
      })
      .catch(() => {
        set((s) => ({ computing: { ...s.computing, [messageId]: false } }))
      })
  },
}))
