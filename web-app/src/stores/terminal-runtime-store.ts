import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type TerminalSessionStatus = 'running' | 'exited' | 'failed'

export type TerminalSessionInfo = {
  sessionId: string
  cwd?: string
  shell: string
  status: TerminalSessionStatus
  createdAt: number
  updatedAt: number
  exitCode?: number | null
  processId?: number | null
}

type TerminalRuntimeState = {
  sessions: Record<string, TerminalSessionInfo>
  sessionNames: Record<string, string>
  activeSessionId: string | null
  hydrateSessions: (sessions: TerminalSessionInfo[]) => void
  upsertSession: (session: TerminalSessionInfo) => void
  setActiveSession: (sessionId: string | null) => void
  renameSession: (sessionId: string, name: string) => void
  markExited: (sessionId: string, exitCode?: number | null) => void
}

export const useTerminalRuntime = create<TerminalRuntimeState>()(
  persist(
    (set) => ({
      sessions: {},
      sessionNames: {},
      activeSessionId: null,

      hydrateSessions: (sessions) => {
        set((state) => {
          const nextSessions = sessions.reduce<
            Record<string, TerminalSessionInfo>
          >((acc, session) => {
            acc[session.sessionId] = session
            return acc
          }, {})
          const activeStillExists =
            state.activeSessionId && nextSessions[state.activeSessionId]
          const fallbackSession =
            sessions
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .find((session) => session.status === 'running') ?? sessions[0]

          return {
            sessions: nextSessions,
            activeSessionId: activeStillExists
              ? state.activeSessionId
              : fallbackSession?.sessionId ?? null,
          }
        })
      },

      upsertSession: (session) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [session.sessionId]: session,
          },
          activeSessionId: state.activeSessionId ?? session.sessionId,
        }))
      },

      setActiveSession: (activeSessionId) => set({ activeSessionId }),

      renameSession: (sessionId, name) => {
        set((state) => ({
          sessionNames: {
            ...state.sessionNames,
            [sessionId]: name.trim(),
          },
        }))
      },

      markExited: (sessionId, exitCode) => {
        set((state) => {
          const current = state.sessions[sessionId]
          if (!current) return state

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...current,
                status: 'exited',
                exitCode,
                updatedAt: Date.now(),
              },
            },
          }
        })
      },
    }),
    {
      name: localStorageKey.terminalRuntime,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessionNames: state.sessionNames,
      }),
    }
  )
)
