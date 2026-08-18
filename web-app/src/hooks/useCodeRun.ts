import { create } from 'zustand'
import type { CodeTurn, SubagentRun, Usage, CodeMessage, TodoList } from '@/hooks/useCodeSessions'
import type { PendingPermission } from '@/containers/dialogs/CodePermissionDialog'
import type { ModelLoadProgress } from '@/hooks/useAppState'

// Mirrors the Rust `Question`/`OptionItem`/`AskRequest` structs (interaction.rs)
// verbatim, same convention as `Usage`/`TodoList` above.
export type AskOption = {
  label: string
  description?: string
}

export type AskQuestion = {
  id: string
  question: string
  options: AskOption[]
  multi?: boolean
  recommended?: number
}

export type AskRequestPayload = {
  questions: AskQuestion[]
}

// Mirrors `QuestionResult` (interaction.rs): one answer per question, either
// selected option label(s) or free-text `custom_input` — never both.
export type AskAnswer = {
  id: string
  selected: string[]
  custom_input?: string
}

// StreamEvent shapes emitted by the Rust agent loop (events.rs, tag = "type").
// Owned here because this store is what consumes/dispatches them.
export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'step'; index: number; max: number }
  | { type: 'tool_call_started'; id: string; name: string }
  | { type: 'tool_call_args_delta'; id: string; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; content: string; is_error: boolean; diff?: string }
  | { type: 'done'; stop_reason: string; usage: Usage | null }
  | { type: 'error'; code: string; message: string }
  | { type: 'messages_updated'; messages: CodeMessage[] }
  | { type: 'todo_update'; list: TodoList }
  | { type: 'ask_request'; request_id: string; request: AskRequestPayload }
  | {
      type: 'permission_request'
      request_id: string
      tool_call_id?: string
      tool_name: string
      capability: string
      path?: string
      command?: string
      diff?: string
      prompt_kind: string
      offers_always: boolean
    }
  | { type: 'subagent_queued'; run_id: string; name: string; waiting: number }
  | { type: 'subagent_start'; run_id: string; name: string }
  | { type: 'subagent_end'; run_id: string; name: string; usage: Usage | null }
  | { type: 'turn_usage'; usage: Usage }
  | { type: 'subagent'; run_id: string; name: string; event: StreamEvent }

// Append a streamed token to the last assistant turn, or start a new one.
// Shared by the main stream (appendToken) and a subagent's wrapped stream
// (applyInnerToTurns) — same merge, different turn lane.
function appendAssistantToken(turns: CodeTurn[], text: string): CodeTurn[] {
  const last = turns[turns.length - 1]
  if (last && last.role === 'assistant')
    return [...turns.slice(0, -1), { ...last, content: last.content + text }]
  return [...turns, { role: 'assistant', content: text }]
}

// A freshly-dispatched tool call's turn. Shared by the main stream's
// pushToolTurn call site (code.tsx) and a subagent's wrapped tool_call.
export function makeToolCallTurn(ev: {
  id: string
  name: string
  args: unknown
}): CodeTurn {
  return {
    role: 'tool',
    content: '',
    callId: ev.id,
    name: ev.name,
    args: ev.args,
    status: 'running',
  }
}

// Find the tool turn by callId and merge patch onto it; returns the same
// array reference (no-op) when there's no match, so callers can cheaply
// detect "nothing changed". Shared by updateToolTurn and applyInnerToTurns.
function mergeToolResult(
  turns: CodeTurn[],
  callId: string,
  patch: Partial<CodeTurn>
): CodeTurn[] {
  const idx = turns.findIndex((tn) => tn.role === 'tool' && tn.callId === callId)
  if (idx === -1) return turns
  return [...turns.slice(0, idx), { ...turns[idx], ...patch }, ...turns.slice(idx + 1)]
}

// Apply one wrapped inner subagent event to that subagent's own turn lane
// (token append / tool_call push / tool_result merge). Pure.
function applyInnerToTurns(turns: CodeTurn[], inner: StreamEvent): CodeTurn[] {
  switch (inner.type) {
    case 'token':
      return appendAssistantToken(turns, inner.text)
    case 'tool_call_started': {
      if (turns.some((tn) => tn.role === 'tool' && tn.callId === inner.id)) return turns
      return [
        ...turns,
        { role: 'tool', content: '', callId: inner.id, name: inner.name, args: null, argsLive: '', status: 'running' },
      ]
    }
    case 'tool_call_args_delta': {
      const idx = turns.findIndex((tn) => tn.role === 'tool' && tn.callId === inner.id)
      if (idx === -1) return turns
      const prev = turns[idx].argsLive ?? ''
      return [...turns.slice(0, idx), { ...turns[idx], argsLive: prev + inner.delta }, ...turns.slice(idx + 1)]
    }
    case 'tool_call':
      return [...turns, makeToolCallTurn(inner)]
    case 'tool_result':
      return mergeToolResult(turns, inner.id, {
        result: inner.content,
        isError: inner.is_error,
        diff: inner.diff,
        status: 'done',
      })
    default:
      return turns // step / anything else: no visible turn
  }
}

function omitKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

// Transient (non-persisted) run state for the Code UI, keyed by session id —
// mirroring useAppState's per-thread Record<id, T> maps. This is what lets a run
// keep updating a background session while another is viewed: every stream write
// targets the session id captured at submit, and rendering reads the viewed id.
//
// No separate `running` flag: a session is running iff it has a runId, so
// that's read directly (runId[sid] != null) instead of a second map that
// would need to be kept in sync with it.
type CodeRunState = {
  liveTurns: Record<string, CodeTurn[]>
  subagents: Record<string, SubagentRun[]>
  runId: Record<string, string>
  pendingPerms: Record<string, PendingPermission[]>
  // In-flight `ask` tool questions per session, same queue shape as
  // pendingPerms (a subagent's wrapped ask is attributed the same way).
  pendingAsks: Record<string, { requestId: string; request: AskRequestPayload }[]>
  // Usage from the latest `done` event, per session. Set once per run (the
  // terminal event); untouched by a `null` usage so a provider that doesn't
  // report it on a given turn doesn't blank out the last known value.
  usage: Record<string, Usage>
  /** Set by the artifacts library so Cowork opens that file on mount. */
  pendingPreview: { sessionId: string; path: string } | null
  // Session ids currently talking to the llamacpp provider, mapped to the
  // model id in flight. Cowork sessions aren't chat threads, so they're
  // invisible to the chat-only signals the global OOM/backend-error listener
  // otherwise keys off; this is how that listener (mounted outside Cowork's
  // component tree, so it still sees a session running in the background)
  // finds the right session(s) to attribute a router-level failure to, and
  // matches load-progress events by model id rather than "whichever session
  // ran most recently".
  llamacppRuns: Record<string, string>
  // A friendlier failure message the listener stashes when the router itself
  // reports why (OOM / backend crash) — submitTurn prefers this over whatever
  // generic message the resulting connection failure produced.
  pendingLlamacppError: Record<string, string>
  // Cowork's own mirror of useAppState's thread-keyed loadingModels /
  // modelLoadProgressByThread, keyed by session id instead of chat thread id.
  // Kept as an entirely separate Record rather than sharing chat's — several
  // chat-side functions (hasActiveLlamacppRequest, clearActiveWork) scan
  // useAppState.loadingModels' *keys* as their "is a real chat thread active"
  // signal; writing Cowork session ids into that same Record would make a
  // Cowork-only model load/failure look like chat activity to those checks.
  loadingModels: Record<string, boolean>
  modelLoadProgress: Record<string, ModelLoadProgress>

  beginRun: (sid: string, runId: string, userText: string, images?: string[]) => void
  appendToken: (sid: string, text: string) => void
  pushToolTurn: (sid: string, turn: CodeTurn) => void
  updateToolTurn: (sid: string, callId: string, patch: Partial<CodeTurn>) => void
  // `tool_call_started`: open a live tool row before any args exist, so the
  // card shows a spot the user can watch fill as the arguments stream.
  announceToolCall: (sid: string, id: string, name: string) => void
  // `tool_call_args_delta`: append raw JSON argument text to the running row.
  appendToolArgs: (sid: string, id: string, delta: string) => void
  startSubagent: (sid: string, runId: string, name: string) => void
  // `subagent_queued`: mark a child as waiting for a concurrency slot.
  queueSubagent: (sid: string, runId: string, name: string, waiting: number) => void
  endSubagent: (sid: string, runId: string, usage?: Usage | null) => void
  routeIntoSubagent: (sid: string, runId: string, inner: StreamEvent) => void
  attachSubagentOutput: (sid: string, runId: string, content: string) => void
  setUsage: (sid: string, usage: Usage | null) => void
  requestPreview: (sessionId: string, path: string) => void
  clearPendingPreview: () => void
  setLlamacppRun: (sid: string, modelId: string) => void
  clearLlamacppRun: (sid: string) => void
  setPendingLlamacppError: (sid: string, message: string) => void
  /** Reads and clears in one step, so a message can't be applied twice. */
  takePendingLlamacppError: (sid: string) => string | undefined
  setSessionLoadingModel: (sid: string, loading: boolean) => void
  setSessionModelLoadProgress: (
    sid: string,
    progress: ModelLoadProgress | undefined
  ) => void
  addPendingPerm: (sid: string, perm: PendingPermission) => void
  removePendingPerm: (sid: string, requestId: string) => void
  addPendingAsk: (sid: string, requestId: string, request: AskRequestPayload) => void
  removePendingAsk: (sid: string, requestId: string) => void
  // Mark running tool turns + subagents done (interrupted). Leaves
  // liveTurns/subagents in place and returns the final values so the caller
  // can commit them before clearCodeRun without a second round of store
  // reads. Run-level failure is surfaced separately via `useMessageErrors`,
  // not through this function.
  finalizeRun: (sid: string) => { turns: CodeTurn[]; subagents: SubagentRun[] }
  clearCodeRun: (sid: string) => void
}

export const useCodeRun = create<CodeRunState>()((set, get) => ({
  liveTurns: {},
  subagents: {},
  runId: {},
  pendingPerms: {},
  pendingAsks: {},
  usage: {},
  pendingPreview: null,
  llamacppRuns: {},
  pendingLlamacppError: {},
  loadingModels: {},
  modelLoadProgress: {},

  beginRun: (sid, runId, userText, images) =>
    set((s) => ({
      runId: { ...s.runId, [sid]: runId },
      liveTurns: {
        ...s.liveTurns,
        [sid]: [{ role: 'user', content: userText, images }],
      },
      subagents: { ...s.subagents, [sid]: [] },
      pendingPerms: { ...s.pendingPerms, [sid]: [] },
      pendingAsks: { ...s.pendingAsks, [sid]: [] },
    })),

  appendToken: (sid, text) =>
    set((s) => ({
      liveTurns: {
        ...s.liveTurns,
        [sid]: appendAssistantToken(s.liveTurns[sid] ?? [], text),
      },
    })),

  pushToolTurn: (sid, turn) =>
    set((s) => ({
      liveTurns: { ...s.liveTurns, [sid]: [...(s.liveTurns[sid] ?? []), turn] },
    })),

  updateToolTurn: (sid, callId, patch) =>
    set((s) => {
      const turns = s.liveTurns[sid] ?? []
      const next = mergeToolResult(turns, callId, patch)
      return next === turns ? {} : { liveTurns: { ...s.liveTurns, [sid]: next } }
    }),

  announceToolCall: (sid, id, name) =>
    set((s) => {
      const turns = s.liveTurns[sid] ?? []
      if (turns.some((tn) => tn.role === 'tool' && tn.callId === id)) return {}
      return {
        liveTurns: {
          ...s.liveTurns,
          [sid]: [
            ...turns,
            { role: 'tool', content: '', callId: id, name, args: null, argsLive: '', status: 'running' },
          ],
        },
      }
    }),

  appendToolArgs: (sid, id, delta) =>
    set((s) => {
      const turns = s.liveTurns[sid] ?? []
      const idx = turns.findIndex((tn) => tn.role === 'tool' && tn.callId === id)
      if (idx === -1) return {}
      const prev = turns[idx].argsLive ?? ''
      return {
        liveTurns: {
          ...s.liveTurns,
          [sid]: [...turns.slice(0, idx), { ...turns[idx], argsLive: prev + delta }, ...turns.slice(idx + 1)],
        },
      }
    }),

  startSubagent: (sid, runId, name) =>
    set((s) => {
      const runs = s.subagents[sid] ?? []
      // Promote a queued child the moment its slot frees; otherwise create it.
      const idx = runs.findIndex((r) => r.runId === runId)
      if (idx !== -1) {
        const existing = runs[idx]
        if (existing.status === 'queued') {
          return {
            subagents: {
              ...s.subagents,
              [sid]: [
                ...runs.slice(0, idx),
                { ...existing, status: 'running' as const, waiting: undefined, startedAt: Date.now() },
                ...runs.slice(idx + 1),
              ],
            },
          }
        }
        return {}
      }
      return {
        subagents: {
          ...s.subagents,
          [sid]: [
            ...runs,
            { runId, name, status: 'running', startedAt: Date.now(), turns: [] },
          ],
        },
      }
    }),

  queueSubagent: (sid, runId, name, waiting) =>
    set((s) => {
      const runs = s.subagents[sid] ?? []
      if (runs.some((r) => r.runId === runId)) return {}
      return {
        subagents: {
          ...s.subagents,
          [sid]: [
            ...runs,
            { runId, name, status: 'queued', waiting, startedAt: Date.now(), turns: [] },
          ],
        },
      }
    }),


  endSubagent: (sid, runId, usage) =>
    set((s) => ({
      subagents: {
        ...s.subagents,
        [sid]: (s.subagents[sid] ?? []).map((r) =>
          r.runId === runId && r.status !== 'done'
            ? {
                ...r,
                status: 'done' as const,
                endedAt: Date.now(),
                usage: usage ?? undefined,
              }
            : r
        ),
      },
    })),

  routeIntoSubagent: (sid, runId, inner) =>
    set((s) => ({
      subagents: {
        ...s.subagents,
        [sid]: (s.subagents[sid] ?? []).map((r) =>
          r.runId === runId ? { ...r, turns: applyInnerToTurns(r.turns, inner) } : r
        ),
      },
    })),

  attachSubagentOutput: (sid, runId, content) =>
    set((s) => ({
      subagents: {
        ...s.subagents,
        [sid]: (s.subagents[sid] ?? []).map((r) =>
          r.runId === runId && r.finalOutput == null ? { ...r, finalOutput: content } : r
        ),
      },
    })),

  setUsage: (sid, usage) =>
    set((s) => (usage ? { usage: { ...s.usage, [sid]: usage } } : {})),

  requestPreview: (sessionId, path) => set({ pendingPreview: { sessionId, path } }),
  clearPendingPreview: () => set({ pendingPreview: null }),

  setLlamacppRun: (sid, modelId) =>
    set((s) => ({ llamacppRuns: { ...s.llamacppRuns, [sid]: modelId } })),
  clearLlamacppRun: (sid) =>
    set((s) => ({ llamacppRuns: omitKey(s.llamacppRuns, sid) })),
  setPendingLlamacppError: (sid, message) =>
    set((s) => ({
      pendingLlamacppError: { ...s.pendingLlamacppError, [sid]: message },
    })),
  takePendingLlamacppError: (sid) => {
    const message = get().pendingLlamacppError[sid]
    if (message !== undefined) {
      set((s) => ({ pendingLlamacppError: omitKey(s.pendingLlamacppError, sid) }))
    }
    return message
  },
  setSessionLoadingModel: (sid, loading) =>
    set((s) => {
      const next = { ...s.loadingModels }
      if (loading) next[sid] = true
      else delete next[sid]
      return { loadingModels: next }
    }),
  setSessionModelLoadProgress: (sid, progress) =>
    set((s) => {
      const next = { ...s.modelLoadProgress }
      if (progress) next[sid] = progress
      else delete next[sid]
      return { modelLoadProgress: next }
    }),

  addPendingPerm: (sid, perm) =>
    set((s) => ({
      pendingPerms: {
        ...s.pendingPerms,
        [sid]: [...(s.pendingPerms[sid] ?? []), perm],
      },
    })),

  removePendingPerm: (sid, requestId) =>
    set((s) => ({
      pendingPerms: {
        ...s.pendingPerms,
        [sid]: (s.pendingPerms[sid] ?? []).filter((p) => p.requestId !== requestId),
      },
    })),

  addPendingAsk: (sid, requestId, request) =>
    set((s) => ({
      pendingAsks: {
        ...s.pendingAsks,
        [sid]: [...(s.pendingAsks[sid] ?? []), { requestId, request }],
      },
    })),

  removePendingAsk: (sid, requestId) =>
    set((s) => ({
      pendingAsks: {
        ...s.pendingAsks,
        [sid]: (s.pendingAsks[sid] ?? []).filter((a) => a.requestId !== requestId),
      },
    })),

  finalizeRun: (sid) => {
    // Run-level failure surfaces via `useMessageErrors` (Generation-failed
    // banner), not as a synthetic tool-error turn — that used to render a
    // misleading error-styled tool card even though no tool call failed.
    const turns: CodeTurn[] = (get().liveTurns[sid] ?? []).map((tn) =>
      tn.role === 'tool' && tn.status === 'running'
        ? { ...tn, status: 'done' as const, isError: true, result: tn.result || '(interrupted)' }
        : tn
    )
    const subs = (get().subagents[sid] ?? []).map((r) =>
      r.status !== 'done' ? { ...r, status: 'done' as const, endedAt: Date.now() } : r
    )
    set((s) => ({
      liveTurns: { ...s.liveTurns, [sid]: turns },
      subagents: { ...s.subagents, [sid]: subs },
    }))
    return { turns, subagents: subs }
  },

  clearCodeRun: (sid) =>
    set((s) => ({
      liveTurns: omitKey(s.liveTurns, sid),
      subagents: omitKey(s.subagents, sid),
      runId: omitKey(s.runId, sid),
      pendingPerms: omitKey(s.pendingPerms, sid),
      pendingAsks: omitKey(s.pendingAsks, sid),
      usage: omitKey(s.usage, sid),
      llamacppRuns: omitKey(s.llamacppRuns, sid),
      pendingLlamacppError: omitKey(s.pendingLlamacppError, sid),
      loadingModels: omitKey(s.loadingModels, sid),
      modelLoadProgress: omitKey(s.modelLoadProgress, sid),
    })),
}))

// Per-session selectors, mirroring useAppState's useIsThreadActive — a
// component reading only one session's slice re-renders on that session's
// changes, not on every other session's.
export const useIsSessionActive = (sid: string | undefined) =>
  useCodeRun((s) => (sid ? s.runId[sid] != null : false))

export const useSessionHasPendingPerms = (sid: string | undefined) =>
  useCodeRun((s) => (sid ? (s.pendingPerms[sid]?.length ?? 0) > 0 : false))
