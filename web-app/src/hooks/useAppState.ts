import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'

type AppState = {
  streamingContent?: ThreadMessage
  updateStreamingContent: (content: ThreadMessage | undefined) => void
}

export const useAppState = create<AppState>()((set) => ({
  streamingContent: undefined,
  updateStreamingContent: (content) => {
    set({ streamingContent: content })
  },
}))
