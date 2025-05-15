import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'

type AppState = {
  streamingContent?: ThreadMessage
  loadingModel?: boolean
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  updateLoadingModel: (loading: boolean) => void
}

export const useAppState = create<AppState>()((set) => ({
  streamingContent: undefined,
  loadingModel: false,
  updateStreamingContent: (content) => {
    set({ streamingContent: content })
  },
  updateLoadingModel: (loading) => {
    set({ loadingModel: loading })
  },
}))
