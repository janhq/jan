import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { MCPTool } from '@/types/completion'

export type PromptProgress = {
  cache: number
  processed: number
  time_ms: number
  total: number
}

type AppErrorMessage = {
  message?: string
  title?: string
  subtitle: string
}

type AppState = {
  streamingContent?: ThreadMessage
  loadingModel?: boolean
  tools: MCPTool[]
  ragToolNames: Set<string>
  mcpToolNames: Set<string>
  serverStatus: 'running' | 'stopped' | 'pending'
  abortControllers: Record<string, AbortController>
  tokenSpeed?: TokenSpeed
  showOutOfContextDialog?: boolean
  errorMessage?: AppErrorMessage
  promptProgress?: PromptProgress
  activeModels: string[]
  cancelToolCall?: () => void

  streamingContents: Record<string, ThreadMessage>
  loadingModels: Record<string, boolean>
  promptProgresses: Record<string, PromptProgress>
  tokenSpeeds: Record<string, TokenSpeed>
  cancelToolCalls: Record<string, () => void>
  errorMessages: Record<string, AppErrorMessage>
  currentStreamThreadId?: string

  setServerStatus: (value: 'running' | 'stopped' | 'pending') => void
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  updateLoadingModel: (loading: boolean) => void
  updateTools: (tools: MCPTool[]) => void
  updateRagToolNames: (names: string[]) => void
  updateMcpToolNames: (names: string[]) => void
  setAbortController: (threadId: string, controller: AbortController) => void
  updateTokenSpeed: (message: ThreadMessage, increment?: number) => void
  setTokenSpeed: (
    message: ThreadMessage,
    speed: number,
    completionTokens: number
  ) => void
  resetTokenSpeed: () => void
  clearAppState: () => void
  setOutOfContextDialog: (show: boolean) => void
  setCancelToolCall: (cancel: (() => void) | undefined) => void
  setErrorMessage: (error: AppErrorMessage | undefined) => void
  updatePromptProgress: (progress: PromptProgress | undefined) => void
  setActiveModels: (models: string[]) => void

  updateThreadStreamingContent: (
    threadId: string,
    content: ThreadMessage | undefined
  ) => void
  updateThreadLoadingModel: (threadId: string, loading: boolean) => void
  updateThreadPromptProgress: (
    threadId: string,
    progress: PromptProgress | undefined
  ) => void
  updateThreadTokenSpeed: (
    threadId: string,
    message: ThreadMessage,
    increment?: number
  ) => void
  setThreadTokenSpeed: (
    threadId: string,
    message: ThreadMessage,
    speed: number,
    completionTokens: number
  ) => void
  resetThreadTokenSpeed: (threadId: string) => void
  setThreadCancelToolCall: (
    threadId: string,
    cancel: (() => void) | undefined
  ) => void
  setThreadErrorMessage: (
    threadId: string,
    error: AppErrorMessage | undefined
  ) => void
  clearThreadState: (threadId: string) => void
  setCurrentStreamThreadId: (threadId: string | undefined) => void
}

export const useAppState = create<AppState>()((set) => ({
  streamingContent: undefined,
  loadingModel: false,
  tools: [],
  ragToolNames: new Set<string>(),
  mcpToolNames: new Set<string>(),
  serverStatus: 'stopped',
  abortControllers: {},
  tokenSpeed: undefined,
  promptProgress: undefined,
  cancelToolCall: undefined,
  activeModels: [],
  streamingContents: {},
  loadingModels: {},
  promptProgresses: {},
  tokenSpeeds: {},
  cancelToolCalls: {},
  errorMessages: {},
  currentStreamThreadId: undefined,
  setCurrentStreamThreadId: (threadId) => set({ currentStreamThreadId: threadId }),
  updateStreamingContent: (content: ThreadMessage | undefined) => {
    set(() => ({
      streamingContent: content
        ? {
            ...content,
            created_at: content.created_at || Date.now(),
          }
        : undefined,
    }))
  },
  updateLoadingModel: (loading) => {
    set({ loadingModel: loading })
  },
  updateTools: (tools) => {
    set({ tools })
  },
  updateRagToolNames: (names) => {
    set({ ragToolNames: new Set(names) })
  },
  updateMcpToolNames: (names) => {
    set({ mcpToolNames: new Set(names) })
  },
  setServerStatus: (value) => set({ serverStatus: value }),
  setAbortController: (threadId, controller) => {
    set((state) => ({
      abortControllers: {
        ...state.abortControllers,
        [threadId]: controller,
      },
    }))
  },
  setTokenSpeed: (message, speed, completionTokens) => {
    set((state) => ({
      tokenSpeed: {
        ...state.tokenSpeed,
        lastTimestamp: new Date().getTime(),
        tokenSpeed: speed,
        tokenCount: completionTokens,
        message: message.id,
      },
    }))
  },
  updateTokenSpeed: (message, increment = 1) =>
    set((state) => {
      const currentTimestamp = new Date().getTime() // Get current time in milliseconds
      if (!state.tokenSpeed) {
        // If this is the first update, just set the lastTimestamp and return
        return {
          tokenSpeed: {
            lastTimestamp: currentTimestamp,
            tokenSpeed: 0,
            tokenCount: increment,
            message: message.id,
          },
        }
      }

      const timeDiffInSeconds =
        (currentTimestamp - state.tokenSpeed.lastTimestamp) / 1000 // Time difference in seconds
      const totalTokenCount = state.tokenSpeed.tokenCount + increment
      const averageTokenSpeed =
        totalTokenCount / (timeDiffInSeconds > 0 ? timeDiffInSeconds : 1) // Calculate average token speed
      return {
        tokenSpeed: {
          ...state.tokenSpeed,
          tokenSpeed: averageTokenSpeed,
          tokenCount: totalTokenCount,
          message: message.id,
        },
      }
    }),
  resetTokenSpeed: () =>
    set({
      tokenSpeed: undefined,
    }),
  clearAppState: () =>
    set({
      streamingContent: undefined,
      abortControllers: {},
      tokenSpeed: undefined,
      cancelToolCall: undefined,
      errorMessage: undefined,
      showOutOfContextDialog: false,
    }),
  setOutOfContextDialog: (show) => {
    set(() => ({
      showOutOfContextDialog: show,
    }))
  },
  setCancelToolCall: (cancel) => {
    set(() => ({
      cancelToolCall: cancel,
    }))
  },
  setErrorMessage: (error) => {
    set(() => ({
      errorMessage: error,
    }))
  },
  updatePromptProgress: (progress) => {
    set(() => ({
      promptProgress: progress,
    }))
  },
  setActiveModels: (models: string[]) => {
    set(() => ({
      activeModels: models,
    }))
  },

  updateThreadStreamingContent: (threadId, content) =>
    set((state) => {
      const next = { ...state.streamingContents }
      if (content) {
        next[threadId] = {
          ...content,
          created_at: content.created_at || Date.now(),
        }
      } else {
        delete next[threadId]
      }
      return { streamingContents: next }
    }),
  updateThreadLoadingModel: (threadId, loading) =>
    set((state) => {
      const next = { ...state.loadingModels }
      if (loading) next[threadId] = true
      else delete next[threadId]
      return { loadingModels: next }
    }),
  updateThreadPromptProgress: (threadId, progress) =>
    set((state) => {
      const next = { ...state.promptProgresses }
      if (progress) next[threadId] = progress
      else delete next[threadId]
      return { promptProgresses: next }
    }),
  setThreadTokenSpeed: (threadId, message, speed, completionTokens) =>
    set((state) => ({
      tokenSpeeds: {
        ...state.tokenSpeeds,
        [threadId]: {
          ...state.tokenSpeeds[threadId],
          lastTimestamp: Date.now(),
          tokenSpeed: speed,
          tokenCount: completionTokens,
          message: message.id,
        },
      },
    })),
  updateThreadTokenSpeed: (threadId, message, increment = 1) =>
    set((state) => {
      const now = Date.now()
      const prev = state.tokenSpeeds[threadId]
      if (!prev) {
        return {
          tokenSpeeds: {
            ...state.tokenSpeeds,
            [threadId]: {
              lastTimestamp: now,
              tokenSpeed: 0,
              tokenCount: increment,
              message: message.id,
            },
          },
        }
      }
      const elapsed = (now - prev.lastTimestamp) / 1000
      const total = prev.tokenCount + increment
      return {
        tokenSpeeds: {
          ...state.tokenSpeeds,
          [threadId]: {
            ...prev,
            tokenSpeed: total / (elapsed > 0 ? elapsed : 1),
            tokenCount: total,
            message: message.id,
          },
        },
      }
    }),
  resetThreadTokenSpeed: (threadId) =>
    set((state) => {
      if (!(threadId in state.tokenSpeeds)) return state
      const next = { ...state.tokenSpeeds }
      delete next[threadId]
      return { tokenSpeeds: next }
    }),
  setThreadCancelToolCall: (threadId, cancel) =>
    set((state) => {
      const next = { ...state.cancelToolCalls }
      if (cancel) next[threadId] = cancel
      else delete next[threadId]
      return { cancelToolCalls: next }
    }),
  setThreadErrorMessage: (threadId, error) =>
    set((state) => {
      const next = { ...state.errorMessages }
      if (error) next[threadId] = error
      else delete next[threadId]
      return { errorMessages: next }
    }),
  clearThreadState: (threadId) =>
    set((state) => {
      const streamingContents = { ...state.streamingContents }
      const loadingModels = { ...state.loadingModels }
      const promptProgresses = { ...state.promptProgresses }
      const tokenSpeeds = { ...state.tokenSpeeds }
      const cancelToolCalls = { ...state.cancelToolCalls }
      const errorMessages = { ...state.errorMessages }
      delete streamingContents[threadId]
      delete loadingModels[threadId]
      delete promptProgresses[threadId]
      delete tokenSpeeds[threadId]
      delete cancelToolCalls[threadId]
      delete errorMessages[threadId]
      return {
        streamingContents,
        loadingModels,
        promptProgresses,
        tokenSpeeds,
        cancelToolCalls,
        errorMessages,
      }
    }),
}))

export const useActiveThreadIds = () =>
  useAppState((state) => {
    const ids = new Set<string>()
    Object.keys(state.streamingContents).forEach((id) => ids.add(id))
    Object.keys(state.loadingModels).forEach((id) => ids.add(id))
    Object.keys(state.cancelToolCalls).forEach((id) => ids.add(id))
    return ids
  })

export const useIsThreadActive = (threadId: string | undefined) =>
  useAppState((state) =>
    threadId
      ? threadId in state.streamingContents ||
        threadId in state.loadingModels ||
        threadId in state.cancelToolCalls
      : false
  )
