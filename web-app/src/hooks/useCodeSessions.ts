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
  // User-row only: data URLs of images attached via paste/file picker.
  images?: string[]
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
// `content` is a plain string for text-only turns; a multimodal array (mirrors
// the OpenAI chat content-parts shape the Rust side already accepts verbatim,
// see upstream.rs::parse_openai_messages) when images are attached.
export type CodeMessage = {
  role: 'user' | 'assistant'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
}

// One background subagent run, bucketed by its own run_id so concurrent
// subagents never share a transcript lane. Lives transiently in useCodeRun
// while running, then the finished set is committed onto its session so it
// survives a session switch and app restart.
export type SubagentRun = {
  runId: string
  name: string
  status: 'running' | 'done'
  startedAt: number
  endedAt?: number
  // The subagent's own trace (wrapped token/tool events). The final answer is
  // NOT here — it's captured into `finalOutput` from the parent's
  // await_subagent result.
  turns: CodeTurn[]
  finalOutput?: string
  // From the child's own terminal completion (SubagentEnd). Undefined while
  // running, or if the provider didn't report usage.
  usage?: Usage
}

// Mirrors the Rust `Usage` struct (events.rs) verbatim — snake_case field
// names, no renaming, since this never flows through the regular chat's
// ThreadMessage-shaped token-counting path.
export type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

// Mirrors the run-mode mechanisms the agent core actually exposes: `--yolo`
// (bypass permissions, reachable via agent_run's `yolo` body field) and the
// TUI/CLI's read-only `--plan` mode (mutation-capable tools hard-denied at
// the dispatcher, reachable via agent_run's `plan` body field).
export type CodeRunMode = 'normal' | 'yolo' | 'plan'

// Mirrors the Rust `TodoItem`/`TodoPhase`/`TodoList` structs (todo.rs)
// verbatim, same convention as `Usage` above.
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned'

export type TodoItem = {
  content: string
  status: TodoStatus
}

export type TodoPhase = {
  name: string
  tasks: TodoItem[]
}

export type TodoList = {
  phases: TodoPhase[]
}

export type CodeSession = {
  id: string
  title: string
  folder: string | null
  turns: CodeTurn[]
  history: CodeMessage[]
  // Per-session so switching sessions doesn't change how a background run
  // behaves. Absent means 'normal' (the safe default).
  mode?: CodeRunMode
  // Finished subagents from the most recent run in this session (replace, not
  // append). Undefined for sessions that never spawned any.
  subagents?: SubagentRun[]
  // Usage from the most recent run's terminal `done` event. Undefined until a
  // run completes with a provider that reports usage.
  lastUsage?: Usage
  // `/goal` state (mirrors the TUI's in-loop evaluator, see goal.rs) — set by
  // `/goal <condition>`, checked after each turn completes, cleared by
  // `/goal clear` or once the evaluator reports it met.
  goal?: CodeGoal
  // Canonical session todo list (mirrors the TUI's todo tool/HUD, see
  // todo.rs). Sent back to agent_run each turn so the model's plan persists
  // across turns; updated from `todo_update` stream events. Undefined until
  // the model first calls the `todo` tool.
  todos?: TodoList
  updated: number
}

export type CodeGoal = {
  condition: string
  turns: number
  status: 'active' | 'achieved'
  lastReason: string
}

type CodeSessionsState = {
  sessions: CodeSession[]
  currentId: string | null
  createSession: () => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  setFolder: (id: string, folder: string) => void
  setTitle: (id: string, title: string) => void
  setMode: (id: string, mode: CodeRunMode) => void
  setHistory: (id: string, history: CodeMessage[]) => void
  setGoal: (id: string, goal: CodeGoal | null) => void
  setTodos: (id: string, todos: TodoList) => void
  commitTurns: (
    id: string,
    turns: CodeTurn[],
    history: CodeMessage[],
    subagents: SubagentRun[],
    usage?: Usage
  ) => void
  clearSession: (id: string) => void
}

const now = () => Date.now()

export const useCodeSessions = create<CodeSessionsState>()(
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

      setMode: (id, mode) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, mode } : x)),
        })),

      setHistory: (id, history) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, history, updated: now() } : x
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

      commitTurns: (id, turns, history, subagents, usage) =>
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== id) return x
            // Accumulate across this session's runs, keyed by runId — a later
            // run that dispatches no subagents of its own must not erase what
            // an earlier run in the same session already finished.
            const priorIds = new Set(subagents.map((r) => r.runId))
            const merged = [
              ...(x.subagents ?? []).filter((r) => !priorIds.has(r.runId)),
              ...subagents,
            ]
            return {
              ...x,
              turns: [...x.turns, ...turns],
              history,
              subagents: merged,
              lastUsage: usage ?? x.lastUsage,
              updated: now(),
            }
          }),
        })),

      clearSession: (id) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id
              ? { ...x, turns: [], history: [], subagents: [], updated: now() }
              : x
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
