import { create } from 'zustand'

export type CodexAppServerLogLine = {
  sessionId: string
  stream: 'stdout' | 'stderr' | 'system'
  line: string
  timestamp: number
}

type CodexAppServerRuntimeState = {
  logs: CodexAppServerLogLine[]
  appendLog: (line: CodexAppServerLogLine) => void
  clearLogs: () => void
  getLogText: (sessionId?: string, maxChars?: number) => string
}

const MAX_LOG_LINES = 500

export const useCodexAppServerRuntime =
  create<CodexAppServerRuntimeState>()((set, get) => ({
    logs: [],

    appendLog: (line) =>
      set((state) => ({
        logs: [...state.logs, line].slice(-MAX_LOG_LINES),
      })),

    clearLogs: () => set({ logs: [] }),

    getLogText: (sessionId, maxChars = 16000) => {
      const lines = get().logs.filter(
        (line) => !sessionId || line.sessionId === sessionId
      )
      const text = lines
        .map((line) => {
          const timestamp = new Date(line.timestamp).toISOString()
          return `[${timestamp}] [${line.sessionId}] [${line.stream}] ${line.line}`
        })
        .join('\n')
        .trim()

      return text.length > maxChars ? text.slice(text.length - maxChars) : text
    },
  }))
