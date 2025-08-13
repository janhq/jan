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
  promptsByThread: Record<string, string>
  queuedMessagesByThread: Record<string, string[]>
  errorsByThread: Record<string, string | ErrorObject | undefined>

  // === CONCURRENT PROCESSING STATE ===
  processingThreads: Record<string, boolean>
  maxConcurrency: number
  fallbackMode: 'single-thread' | 'estimated' | 'detected' | 'user-configured'
  parallelProcessingEnabled: boolean

  // === LEGACY METHODS (unchanged for backward compatibility) ===
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  updateTokenSpeed: (message: ThreadMessage, increment?: number) => void
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
  updateTokenSpeed: (message: ThreadMessage, increment?: number) => void
  resetTokenSpeed: () => void
  setOutOfContextDialog: (show: boolean) => void

  // === NEW THREAD-AWARE METHODS ===
  setThreadPrompt: (threadId: string, prompt: string) => void
  getThreadPrompt: (threadId: string) => string
  clearThreadPrompt: (threadId: string) => void
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

  // === CONCURRENT PROCESSING METHODS ===
  setThreadProcessing: (threadId: string, isProcessing: boolean) => void
  setMaxConcurrency: (count: number) => void
  setFallbackMode: (
    mode: 'single-thread' | 'estimated' | 'detected' | 'user-configured'
  ) => void
  setParallelProcessingEnabled: (enabled: boolean) => void
  getActiveProcessingCount: () => number
  isThreadProcessing: (threadId: string) => boolean
  getAvailableSlots: () => number
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
  promptsByThread: {},
  queuedMessagesByThread: {},
  errorsByThread: {},

  // === CONCURRENT PROCESSING STATE ===
  processingThreads: {},
  maxConcurrency: 1,
  fallbackMode: 'single-thread',
  parallelProcessingEnabled: false,
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
  updateTokenSpeed: (message, increment = 1) =>
    set((state) => {
      const currentTimestamp = new Date().getTime()
      if (!state.tokenSpeed) {
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
  setThreadPrompt: (threadId: string, prompt: string) => {
    set((state) => ({
      promptsByThread: {
        ...state.promptsByThread,
        [threadId]: prompt,
      },
    }))
  },

  getThreadPrompt: (threadId: string) => {
    const state = get()
    return state.promptsByThread[threadId] || ''
  },

  clearThreadPrompt: (threadId: string) => {
    set((state) => ({
      promptsByThread: {
        ...state.promptsByThread,
        [threadId]: '',
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
      const newPrompts = { ...state.promptsByThread }
      const newQueuedMessages = { ...state.queuedMessagesByThread }
      const newErrors = { ...state.errorsByThread }
      const newAbortControllers = { ...state.abortControllers }
      const newProcessingThreads = { ...state.processingThreads }

      delete newPrompts[threadId]
      delete newQueuedMessages[threadId]
      delete newErrors[threadId]
      delete newAbortControllers[threadId]
      delete newProcessingThreads[threadId]

      return {
        promptsByThread: newPrompts,
        queuedMessagesByThread: newQueuedMessages,
        errorsByThread: newErrors,
        abortControllers: newAbortControllers,
        processingThreads: newProcessingThreads,
      }
    })
  },

  clearAllThreads: () => {
    set({
      promptsByThread: {},
      queuedMessagesByThread: {},
      errorsByThread: {},
      abortControllers: {},
      processingThreads: {},
    })
  },

  getAllActiveThreads: () => {
    const state = useAppState.getState()
    const activeThreads = new Set<string>()

    // Collect thread IDs that have any active state
    Object.keys(state.promptsByThread).forEach((id) => {
      if (state.promptsByThread[id]) activeThreads.add(id)
    })
    Object.keys(state.queuedMessagesByThread).forEach((id) => {
      if (state.queuedMessagesByThread[id]) activeThreads.add(id)
    })
    Object.keys(state.errorsByThread).forEach((id) => {
      if (state.errorsByThread[id]) activeThreads.add(id)
    })

    return Array.from(activeThreads)
  },

  // === CONCURRENT PROCESSING METHODS ===
  setThreadProcessing: (threadId: string, isProcessing: boolean) => {
    set((state) => ({
      processingThreads: {
        ...state.processingThreads,
        [threadId]: isProcessing,
      },
    }))
  },

  setMaxConcurrency: (count: number) => {
    set({ maxConcurrency: Math.max(1, count) }) // Ensure minimum of 1
  },

  setFallbackMode: (
    mode: 'single-thread' | 'estimated' | 'detected' | 'user-configured'
  ) => {
    set({ fallbackMode: mode })
  },

  setParallelProcessingEnabled: (enabled: boolean) => {
    set({ parallelProcessingEnabled: enabled })
  },

  getActiveProcessingCount: () => {
    const state = get()
    return Object.values(state.processingThreads).filter(Boolean).length
  },

  isThreadProcessing: (threadId: string) => {
    const state = get()
    return Boolean(state.processingThreads[threadId])
  },

  getAvailableSlots: () => {
    const state = get()
    return state.maxConcurrency - state.getActiveProcessingCount()
  },
}))
