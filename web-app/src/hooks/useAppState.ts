import { create } from 'zustand'
import { ThreadMessage } from '@janhq/core'
import { MCPTool } from '@/types/completion'
import { useAssistant } from './useAssistant'
import { ChatCompletionMessageToolCall } from 'openai/resources'

type AppErrorMessage = {
  message?: string
  title?: string
  subtitle: string
}

type AppState = {
  streamingContent?: ThreadMessage
  loadingModel?: boolean
  tools: MCPTool[]
  serverStatus: 'running' | 'stopped' | 'pending'
  abortControllers: Record<string, AbortController>
  tokenSpeed?: TokenSpeed
  currentToolCall?: ChatCompletionMessageToolCall
  showOutOfContextDialog?: boolean
  errorMessage?: AppErrorMessage
  cancelToolCall?: () => void
  setServerStatus: (value: 'running' | 'stopped' | 'pending') => void
  updateStreamingContent: (content: ThreadMessage | undefined) => void
  updateCurrentToolCall: (
    toolCall: ChatCompletionMessageToolCall | undefined
  ) => void
  updateLoadingModel: (loading: boolean) => void
  updateTools: (tools: MCPTool[]) => void
  setAbortController: (threadId: string, controller: AbortController) => void
  removeAbortController: (threadId: string) => void
  updateTokenSpeed: (message: ThreadMessage, increment?: number) => void
  resetTokenSpeed: () => void
  setOutOfContextDialog: (show: boolean) => void
  setCancelToolCall: (cancel: (() => void) | undefined) => void
  setErrorMessage: (error: AppErrorMessage | undefined) => void
}

export const useAppState = create<AppState>()((set) => ({
  streamingContent: undefined,
  loadingModel: false,
  tools: [],
  serverStatus: 'stopped',
  abortControllers: {},
  tokenSpeed: undefined,
  currentToolCall: undefined,
  cancelToolCall: undefined,
  updateStreamingContent: (content: ThreadMessage | undefined) => {
    // Get assistant state once to avoid race conditions
    const assistantState = useAssistant.getState()
    const { assistants, currentAssistant } = assistantState

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
    set((state) => {
      // Cleanup existing controller before setting new one
      const existingController = state.abortControllers[threadId]
      if (existingController && !existingController.signal.aborted) {
        existingController.abort('Replaced by new controller')
      }

      return {
        abortControllers: {
          ...state.abortControllers,
          [threadId]: controller,
        },
      }
    })
  },
  removeAbortController: (threadId) => {
    set((state) => {
      // Abort the controller if it's still active
      const controller = state.abortControllers[threadId]
      if (controller && !controller.signal.aborted) {
        controller.abort('Thread completed')
      }

      // Remove from state
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [threadId]: _, ...remainingControllers } = state.abortControllers
      return {
        abortControllers: remainingControllers,
      }
    })
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
}))
