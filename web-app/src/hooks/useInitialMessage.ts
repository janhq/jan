import { create } from 'zustand'

import { Attachment } from '@/types/attachment'

export type InitialMessageFile = {
  type: string
  mediaType: string
  url: string
}

export type InitialMessagePayload = {
  text: string
  files?: InitialMessageFile[]
  documents?: Attachment[]
}

type InitialMessageStore = {
  byThread: Record<string, InitialMessagePayload>
  set: (threadId: string, payload: InitialMessagePayload) => void
  consume: (threadId: string) => InitialMessagePayload | undefined
}

export const useInitialMessage = create<InitialMessageStore>()((set, get) => ({
  byThread: {},
  set: (threadId, payload) => {
    set((state) => ({
      byThread: { ...state.byThread, [threadId]: payload },
    }))
  },
  consume: (threadId) => {
    const payload = get().byThread[threadId]
    if (!payload) return undefined
    set((state) => {
      const next = { ...state.byThread }
      delete next[threadId]
      return { byThread: next }
    })
    return payload
  },
}))
