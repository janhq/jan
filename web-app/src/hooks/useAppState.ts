import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { MCPTool } from '@/types/completion'

type AppState = {
  streamingContent?: ThreadMessage
  loadingModel?: boolean
  tools: MCPTool[]
  serverStatus: 'running' | 'stopped' | 'pending'
  setServerStatus: (value: 'running' | 'stopped' | 'pending') => void
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  updateLoadingModel: (loading: boolean) => void
  updateTools: (tools: MCPTool[]) => void
}

export const useAppState = create<AppState>()((set) => ({
  streamingContent: undefined,
  loadingModel: false,
  tools: [],
  serverStatus: 'stopped',
  updateStreamingContent: (content) => {
    set({ streamingContent: content })
  },
  updateLoadingModel: (loading) => {
    set({ loadingModel: loading })
  },
  updateTools: (tools) => {
    set({ tools })
  },
  setServerStatus: (value) => set({ serverStatus: value }),
}))
