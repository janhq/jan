import { create } from 'zustand'
import type { WebCitation } from '@/components/Citations'

type State = {
  byMessageId: Record<string, Record<string, WebCitation>>
  setForMessage: (messageId: string, citations: WebCitation[]) => void
}

const fingerprint = (map: Record<string, WebCitation>) =>
  Object.keys(map).sort().join('|')

export const useWebCitationStore = create<State>((set) => ({
  byMessageId: {},
  setForMessage: (messageId, citations) => {
    if (!messageId || !citations.length) return
    const map: Record<string, WebCitation> = {}
    for (const c of citations) map[c.url] = c
    set((s) => {
      const prev = s.byMessageId[messageId]
      if (prev && fingerprint(prev) === fingerprint(map)) return s
      return { byMessageId: { ...s.byMessageId, [messageId]: map } }
    })
  },
}))
