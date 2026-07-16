import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

// A single visible transcript entry. `tool` rows are display-only and carry the
// structured call/result so the UI can render a tool card. The extra fields are
// optional for backward-compat with sessions persisted before they existed.
export type CodeTurn = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  // Tool-row only: merged from the `tool_call` + matching `tool_result` events.
  callId?: string
  name?: string
  args?: unknown
  result?: string
  isError?: boolean
  diff?: string
  status?: 'running' | 'done'
}

// OpenAI-style history replayed to the agent on the next turn (no tool rows).
export type CodeMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type CodeSession = {
  id: string
  title: string
  folder: string | null
  turns: CodeTurn[]
  history: CodeMessage[]
  updated: number
}

type CodeSessionsState = {
  sessions: CodeSession[]
  currentId: string | null
  createSession: () => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  setFolder: (id: string, folder: string) => void
  setTitle: (id: string, title: string) => void
  commitTurns: (id: string, turns: CodeTurn[], history: CodeMessage[]) => void
  clearSession: (id: string) => void
}

const now = () => Date.now()

export const useCodeSessions = create<CodeSessionsState>()(
  persist(
    (set) => ({
      sessions: [],
      currentId: null,

      createSession: () => {
        const id = crypto.randomUUID()
        const session: CodeSession = {
          id,
          title: 'New session',
          folder: null,
          turns: [],
          history: [],
          updated: now(),
        }
        set((s) => ({ sessions: [session, ...s.sessions], currentId: id }))
        return id
      },

      selectSession: (id) => set({ currentId: id }),

      deleteSession: (id) =>
        set((s) => {
          const sessions = s.sessions.filter((x) => x.id !== id)
          const currentId =
            s.currentId === id ? (sessions[0]?.id ?? null) : s.currentId
          return { sessions, currentId }
        }),

      setFolder: (id, folder) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, folder, updated: now() } : x
          ),
        })),

      setTitle: (id, title) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)),
        })),

      commitTurns: (id, turns, history) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  turns: [...x.turns, ...turns],
                  history,
                  updated: now(),
                }
              : x
          ),
        })),

      clearSession: (id) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, turns: [], history: [], updated: now() } : x
          ),
        })),
    }),
    {
      name: localStorageKey.codeSessions,
      // Persist through the Rust settings store (see backendStorage) so sessions
      // live in <jan_data>/settings.json instead of webview localStorage.
      // Async storage requires skipHydration + explicit rehydrate in
      // hydrateBackendStores() once the ServiceHub is ready.
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
    }
  )
)

/** Return the current session, creating one if none is selected. */
export function ensureCurrentSession(): string {
  const { currentId, sessions, createSession } = useCodeSessions.getState()
  if (currentId && sessions.some((s) => s.id === currentId)) return currentId
  return createSession()
}
