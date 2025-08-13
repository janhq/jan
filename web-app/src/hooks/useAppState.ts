import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { MCPTool } from '@/types/completion'
import { useAssistant } from './useAssistant'
import { ChatCompletionMessageToolCall } from 'openai/resources'

type AppState = {
  // === LEGACY (backward compatibility) ===
  streamingContent?: ThreadMessage
  tokenSpeed?: TokenSpeed
  queuedMessage: string | null

  // === EXISTING GLOBAL STATE ===
  loadingModel?: boolean
  tools: MCPTool[]
  serverStatus: 'running' | 'stopped' | 'pending'
  abortControllers: Record<string, AbortController>
  currentToolCall?: ChatCompletionMessageToolCall
  showOutOfContextDialog?: boolean

  // === NEW PER-THREAD STATE ===
  streamingContentByThread: Record<string, ThreadMessage | undefined>
  tokenSpeedByThread: Record<string, TokenSpeed | undefined>
  queuedMessagesByThread: Record<string, string[]>
  errorsByThread: Record<string, string | ErrorObject | undefined>

  // === LEGACY METHODS (unchanged for backward compatibility) ===
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  updateTokenSpeed: (message: ThreadMessage) => void
  resetTokenSpeed: () => void
  setQueuedMessage: (message: string | null) => void

  // === EXISTING GLOBAL METHODS ===
  setServerStatus: (value: 'running' | 'stopped' | 'pending') => void
  updateCurrentToolCall: (
    toolCall: ChatCompletionMessageToolCall | undefined
  ) => void
  updateLoadingModel: (loading: boolean) => void
  updateTools: (tools: MCPTool[]) => void
  setAbortController: (threadId: string, controller: AbortController) => void
  setOutOfContextDialog: (show: boolean) => void

  // === NEW THREAD-AWARE METHODS ===
  updateThreadStreamingContent: (
    threadId: string,
    content?: ThreadMessage
  ) => void
  updateThreadTokenSpeed: (threadId: string, tokenSpeed?: TokenSpeed) => void
  resetThreadTokenSpeed: (threadId: string) => void
  addToThreadQueue: (threadId: string, message: string) => void
  removeFromThreadQueue: (threadId: string) => string | undefined
  clearThreadQueue: (threadId: string) => void
  getThreadQueueLength: (threadId: string) => number
  setThreadError: (
    threadId: string,
    error?: string | ErrorObject | null
  ) => void
  clearThread: (threadId: string) => void
  clearAllThreads: () => void
  getAllActiveThreads: () => string[]
}

export const useAppState = create<AppState>()((set, get) => ({
  // === LEGACY (backward compatibility) ===
  streamingContent: undefined,
  tokenSpeed: undefined,
  queuedMessage: null,

  // === EXISTING GLOBAL STATE ===
  loadingModel: false,
  tools: [],
  serverStatus: 'stopped',
  abortControllers: {},
  currentToolCall: undefined,
  showOutOfContextDialog: undefined,

  // === NEW PER-THREAD STATE ===
  streamingContentByThread: {},
  tokenSpeedByThread: {},
  queuedMessagesByThread: {},
  errorsByThread: {},
  updateStreamingContent: (content: ThreadMessage | undefined) => {
    const assistants = useAssistant.getState().assistants
    const currentAssistant = useAssistant.getState().currentAssistant
    const selectedAssistant =
      assistants.find((a) => a.id === currentAssistant.id) || assistants[0]

    set(() => ({
      streamingContent: content
        ? {
            ...content,
            created_at: content.created_at || Date.now(),
            metadata: {
              ...content.metadata,
              assistant: selectedAssistant,
            },
          }
        : undefined,
    }))
  },
  updateCurrentToolCall: (toolCall) => {
    set(() => ({
      currentToolCall: toolCall,
    }))
  },
  updateLoadingModel: (loading) => {
    set({ loadingModel: loading })
  },
  updateTools: (tools) => {
    set({ tools })
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
  updateTokenSpeed: (message) =>
    set((state) => {
      const currentTimestamp = new Date().getTime()
      if (!state.tokenSpeed) {
        return {
          tokenSpeed: {
            lastTimestamp: currentTimestamp,
            tokenSpeed: 0,
            tokenCount: 1,
            message: message.id,
          },
        }
      }

      const timeDiffInSeconds =
        (currentTimestamp - state.tokenSpeed.lastTimestamp) / 1000
      const totalTokenCount = state.tokenSpeed.tokenCount + 1
      const averageTokenSpeed =
        totalTokenCount / (timeDiffInSeconds > 0 ? timeDiffInSeconds : 1)

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
  setOutOfContextDialog: (show) => {
    set(() => ({
      showOutOfContextDialog: show,
    }))
  },
  setQueuedMessage: (message) => {
    set({ queuedMessage: message })
  },

  // === NEW THREAD-AWARE METHODS ===
  updateThreadStreamingContent: (threadId: string, content?: ThreadMessage) => {
    set((state) => {
      const assistants = useAssistant.getState().assistants
      const currentAssistant = useAssistant.getState().currentAssistant
      const selectedAssistant =
        assistants.find((a) => a.id === currentAssistant.id) || assistants[0]

      return {
        streamingContentByThread: {
          ...state.streamingContentByThread,
          [threadId]: content
            ? {
                ...content,
                created_at: content.created_at || Date.now(),
                metadata: {
                  ...content.metadata,
                  assistant: selectedAssistant, // Add this line to use the variable
                },
              }
            : undefined,
        },
      }
    })
  },

  updateThreadTokenSpeed: (threadId: string, tokenSpeed?: TokenSpeed) => {
    set((state) => ({
      tokenSpeedByThread: {
        ...state.tokenSpeedByThread,
        [threadId]: tokenSpeed,
      },
    }))
  },

  addToThreadQueue: (threadId: string, message: string) => {
    set((state) => ({
      queuedMessagesByThread: {
        ...state.queuedMessagesByThread,
        [threadId]: [
          ...(state.queuedMessagesByThread[threadId] || []),
          message,
        ],
      },
    }))
  },

  removeFromThreadQueue: (threadId: string) => {
    let removedMessage: string | undefined
    set((state) => {
      const currentQueue = state.queuedMessagesByThread[threadId] || []
      removedMessage = currentQueue[0]
      return {
        queuedMessagesByThread: {
          ...state.queuedMessagesByThread,
          [threadId]: currentQueue.slice(1),
        },
      }
    })
    return removedMessage
  },

  clearThreadQueue: (threadId: string) => {
    set((state) => ({
      queuedMessagesByThread: {
        ...state.queuedMessagesByThread,
        [threadId]: [],
      },
    }))
  },

  getThreadQueueLength: (threadId: string) => {
    const state = get()
    return state.queuedMessagesByThread[threadId]?.length || 0
  },

  resetThreadTokenSpeed: (threadId: string) => {
    set((state) => ({
      tokenSpeedByThread: {
        ...state.tokenSpeedByThread,
        [threadId]: undefined,
      },
    }))
  },

  setThreadError: (threadId: string, error?: string | ErrorObject | null) => {
    set((state) => ({
      errorsByThread: {
        ...state.errorsByThread,
        [threadId]: error || undefined,
      },
    }))
  },

  clearThread: (threadId: string) => {
    set((state) => {
      const newStreamingContent = { ...state.streamingContentByThread }
      const newTokenSpeed = { ...state.tokenSpeedByThread }
      const newQueuedMessages = { ...state.queuedMessagesByThread }
      const newErrors = { ...state.errorsByThread }
      const newAbortControllers = { ...state.abortControllers }

      delete newStreamingContent[threadId]
      delete newTokenSpeed[threadId]
      delete newQueuedMessages[threadId]
      delete newErrors[threadId]
      delete newAbortControllers[threadId]

      return {
        streamingContentByThread: newStreamingContent,
        tokenSpeedByThread: newTokenSpeed,
        queuedMessagesByThread: newQueuedMessages,
        errorsByThread: newErrors,
        abortControllers: newAbortControllers,
      }
    })
  },

  clearAllThreads: () => {
    set({
      streamingContentByThread: {},
      tokenSpeedByThread: {},
      queuedMessagesByThread: {},
      errorsByThread: {},
      abortControllers: {},
    })
  },

  getAllActiveThreads: () => {
    const state = useAppState.getState()
    const activeThreads = new Set<string>()

    // Collect thread IDs that have any active state
    Object.keys(state.streamingContentByThread).forEach((id) => {
      if (state.streamingContentByThread[id]) activeThreads.add(id)
    })
    Object.keys(state.tokenSpeedByThread).forEach((id) => {
      if (state.tokenSpeedByThread[id]) activeThreads.add(id)
    })
    Object.keys(state.queuedMessagesByThread).forEach((id) => {
      if (state.queuedMessagesByThread[id]) activeThreads.add(id)
    })
    Object.keys(state.errorsByThread).forEach((id) => {
      if (state.errorsByThread[id]) activeThreads.add(id)
    })

    return Array.from(activeThreads)
  },
}))
