import type { UIMessage } from 'ai'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'
import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import { isPingOnly } from '@/lib/coworkPing'
import type {
  CoworkTurn,
  SubagentRun,
  Usage,
  CoworkGoal,
  TodoList,
} from '@/types/coworkSession'

// The transcript/todo/subagent shapes live in a store-free module so panels and
// pure helpers can import them without pulling in zustand. Re-exported here
// because this store is still their most natural import site.
export type {
  CoworkTurn,
  Usage,
  SubagentRun,
  TodoStatus,
  TodoItem,
  TodoPhase,
  TodoList,
  CoworkGoal,
} from '@/types/coworkSession'

/**
 * @deprecated Superseded by `CoworkSession.messages`. This shape cannot model
 * tool calls, so replaying it drops every tool turn — survivable while Rust
 * owned the loop and kept its own history, but not now the client is the
 * history. Retained only so sessions persisted by an earlier build still load.
 */
export type CoworkMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type CoworkSession = {
  id: string
  title: string
  /** An attached project folder, mounted read-only. Writes always land in the
   * session's own sandbox, never here. */
  folder: string | null
  turns: CoworkTurn[]
  /** The authoritative conversation, sent to the model each turn. */
  messages: UIMessage[]
  /** @deprecated Read once to migrate into `messages`, then left alone. */
  history?: CoworkMessage[]
  /** Finished subagent runs across this session, merged by runId. */
  subagents?: SubagentRun[]
  /** Usage from the most recent completed run. */
  lastUsage?: Usage
  /** `/goal` state: checked after each turn, cleared when met. */
  goal?: CoworkGoal
  /** Canonical session todo list, updated by the `todo_write` tool. */
  todos?: TodoList
  /** Plan mode: the agent reads and proposes, without writing. Absent means off. */
  planMode?: boolean
  updated: number
}

type CoworkSessionsState = {
  sessions: CoworkSession[]
  currentId: string | null
  createSession: () => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  setFolder: (id: string, folder: string | null) => void
  setPlanMode: (id: string, planMode: boolean) => void
  setTitle: (id: string, title: string) => void
  setMessages: (id: string, messages: UIMessage[]) => void
  setGoal: (id: string, goal: CoworkGoal | null) => void
  setTodos: (id: string, todos: TodoList) => void
  /**
   * @deprecated Bridge for the pre-AI-SDK Cowork route, which has no
   * `UIMessage[]` to commit. Removed together with that route.
   */
  commitLegacyTurns: (
    id: string,
    turns: CoworkTurn[],
    history: CoworkMessage[]
  ) => void
  commitTurns: (
    id: string,
    turns: CoworkTurn[],
    messages: UIMessage[],
    subagents: SubagentRun[],
    usage?: Usage
  ) => void
  /** Drop everything the agent produced since the last question, so the run can
   * be taken again. Both lists are rewound together or the transcript and the
   * history the model sees would disagree. */
  rewindToLastUser: (id: string) => void
  /** Drop the question at `turnIndex` and everything after it -- the backing
   * operation for editing, retrying or deleting a message partway up the
   * transcript. A no-op unless that turn is a question: the answers to a
   * question cannot outlive it, so there is nowhere else to cut. */
  dropFromTurn: (id: string, turnIndex: number) => void
  clearSession: (id: string) => void
  /** Drop sessions that never got a message, except the current one and any in
   * `keepIds` — callers pass sessions with a run in flight, whose first turns
   * are still transient in useCoworkRun until the run commits them. */
  pruneEmptySessions: (keepIds: string[]) => void
}

const now = () => Date.now()

type RoleLike = { role: string; parts?: unknown }

/**
 * A question the user actually asked.
 *
 * A `<SYSTEM>` ping is a user *message* but never a user *turn*: the transcript
 * has no row for it, so counting it would cut the two lists at different points
 * and leave a session resuming from a note about a subagent.
 */
const isQuestion = (m: RoleLike) => m.role === 'user' && !isPingOnly(m)

/** Index of the `ordinal`-th (0-based) question, or -1. */
function questionIndex(items: RoleLike[], ordinal: number): number {
  let seen = 0
  for (let i = 0; i < items.length; i++) {
    if (!isQuestion(items[i])) continue
    if (seen === ordinal) return i
    seen += 1
  }
  return -1
}

function lastQuestionIndex(items: RoleLike[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (isQuestion(items[i])) return i
  }
  return -1
}

export const useCoworkSessions = create<CoworkSessionsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentId: null,

      createSession: () => {
        // Already viewing an untouched session — reuse it instead of piling
        // up empty ones (e.g. from repeated clicks on "New session").
        const { currentId, sessions } = get()
        const current = sessions.find((s) => s.id === currentId)
        if (current && current.turns.length === 0) return current.id

        const id = crypto.randomUUID()
        const session: CoworkSession = {
          id,
          title: 'New session',
          folder: null,
          turns: [],
          messages: [],
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

      setMessages: (id, messages) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, messages, updated: now() } : x
          ),
        })),

      setGoal: (id, goal) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, goal: goal ?? undefined } : x
          ),
        })),

      setTodos: (id, todos) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, todos } : x)),
        })),

      setPlanMode: (id, planMode) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, planMode, updated: now() } : x
          ),
        })),

      setTitle: (id, title) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)),
        })),

      commitLegacyTurns: (id, turns, history) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? { ...x, turns: [...x.turns, ...turns], history, updated: now() }
              : x
          ),
        })),

      commitTurns: (id, turns, messages, subagents, usage) =>
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== id) return x
            // Accumulate across this session's runs, keyed by runId — a later
            // run that dispatches no subagents of its own must not erase what
            // an earlier run in the same session already finished.
            const incoming = new Set(subagents.map((r) => r.runId))
            return {
              ...x,
              turns: [...x.turns, ...turns],
              messages,
              subagents: [
                ...(x.subagents ?? []).filter((r) => !incoming.has(r.runId)),
                ...subagents,
              ],
              lastUsage: usage ?? x.lastUsage,
              updated: now(),
            }
          }),
        })),

      rewindToLastUser: (id) =>
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== id) return x
            const lastTurn = lastQuestionIndex(x.turns)
            const lastMessage = lastQuestionIndex(x.messages)
            if (lastTurn < 0 || lastMessage < 0) return x
            return {
              ...x,
              // The question survives; the run it produced does not.
              turns: x.turns.slice(0, lastTurn + 1),
              messages: x.messages.slice(0, lastMessage + 1),
              updated: now(),
            }
          }),
        })),

      dropFromTurn: (id, turnIndex) =>
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== id) return x
            if (x.turns[turnIndex]?.role !== 'user') return x
            // The wire history holds messages the transcript has no row for
            // (and vice versa), so the cut is made at the same *question*,
            // counted, rather than at the same index.
            const ordinal = x.turns
              .slice(0, turnIndex)
              .filter((t) => t.role === 'user').length
            const cut = questionIndex(x.messages, ordinal)
            // Out of step (a session saved before the two were kept aligned):
            // truncating the transcript alone would leave the model answering
            // questions the user can no longer see.
            if (cut < 0) return x
            return {
              ...x,
              turns: x.turns.slice(0, turnIndex),
              messages: x.messages.slice(0, cut),
              updated: now(),
            }
          }),
        })),

      clearSession: (id) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  turns: [],
                  messages: [],
                  subagents: [],
                  lastUsage: undefined,
                  updated: now(),
                }
              : x
          ),
        })),

      pruneEmptySessions: (keepIds) =>
        set((s) => {
          const keep = new Set(keepIds)
          const sessions = s.sessions.filter(
            (x) => x.turns.length > 0 || x.id === s.currentId || keep.has(x.id)
          )
          return sessions.length === s.sessions.length ? {} : { sessions }
        }),
    }),
    {
      name: localStorageKey.coworkSessions,
      // Persist through the Rust settings store (see backendStorage) so sessions
      // live in <jan_data>/settings.json instead of webview localStorage.
      // Async storage requires skipHydration + explicit rehydrate in
      // hydrateBackendStores() once the ServiceHub is ready.
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      version: 1,
      // v0 persisted an OpenAI-shaped `history` that could not represent tool
      // calls, so replaying it dropped every tool turn. Rebuild the message
      // list from `turns`, which did record them, and leave `history` in place
      // untouched rather than mutating a blob a rollback would still read.
      migrate: (persisted, version) => {
        const state = persisted as { sessions?: CoworkSession[] } | undefined
        if (version >= 1 || !state?.sessions) return persisted
        return {
          ...state,
          sessions: state.sessions.map((session) =>
            session.messages
              ? session
              : {
                  ...session,
                  messages: coworkTurnsToUIMessages(
                    session.turns ?? [],
                    session.id
                  ),
                }
          ),
        }
      },
    }
  )
)

/**
 * Open the start page: a fresh session (or the untouched current one), with the
 * empty sessions left behind swept out. `runningIds` keeps a session whose
 * first run is still streaming its turns and so has nothing committed yet.
 */
export function startNewSession(runningIds: string[]): string {
  const store = useCoworkSessions.getState()
  const id = store.createSession()
  store.pruneEmptySessions(runningIds)
  return id
}

/** Return the current session, creating one if none is selected. */
export function ensureCurrentSession(): string {
  const { currentId, sessions, createSession } = useCoworkSessions.getState()
  if (currentId && sessions.some((s) => s.id === currentId)) return currentId
  return createSession()
}
