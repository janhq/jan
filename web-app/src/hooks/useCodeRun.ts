import { create } from 'zustand'
import type { CodeTurn, SubagentRun, Usage, CodeMessage } from '@/hooks/useCodeSessions'
import type { PendingPermission } from '@/containers/dialogs/CodePermissionDialog'

// StreamEvent shapes emitted by the Rust agent loop (events.rs, tag = "type").
// Owned here because this store is what consumes/dispatches them.
export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'step'; index: number; max: number }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; content: string; is_error: boolean; diff?: string }
  | { type: 'done'; stop_reason: string; usage: Usage | null }
  | { type: 'error'; code: string; message: string }
  | { type: 'messages_updated'; messages: CodeMessage[] }
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
  | { type: 'subagent_start'; run_id: string; name: string }
  | { type: 'subagent_end'; run_id: string; name: string; usage: Usage | null }
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
  // Usage from the latest `done` event, per session. Set once per run (the
  // terminal event); untouched by a `null` usage so a provider that doesn't
  // report it on a given turn doesn't blank out the last known value.
  usage: Record<string, Usage>

  beginRun: (sid: string, runId: string, userText: string, images?: string[]) => void
  appendToken: (sid: string, text: string) => void
  pushToolTurn: (sid: string, turn: CodeTurn) => void
  updateToolTurn: (sid: string, callId: string, patch: Partial<CodeTurn>) => void
  startSubagent: (sid: string, runId: string, name: string) => void
  endSubagent: (sid: string, runId: string, usage?: Usage | null) => void
  routeIntoSubagent: (sid: string, runId: string, inner: StreamEvent) => void
  attachSubagentOutput: (sid: string, runId: string, content: string) => void
  setUsage: (sid: string, usage: Usage | null) => void
  addPendingPerm: (sid: string, perm: PendingPermission) => void
  removePendingPerm: (sid: string, requestId: string) => void
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
  usage: {},

  beginRun: (sid, runId, userText, images) =>
    set((s) => ({
      runId: { ...s.runId, [sid]: runId },
      liveTurns: {
        ...s.liveTurns,
        [sid]: [{ role: 'user', content: userText, images }],
      },
      subagents: { ...s.subagents, [sid]: [] },
      pendingPerms: { ...s.pendingPerms, [sid]: [] },
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

  startSubagent: (sid, runId, name) =>
    set((s) => {
      const runs = s.subagents[sid] ?? []
      if (runs.some((r) => r.runId === runId)) return {}
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

  endSubagent: (sid, runId, usage) =>
    set((s) => ({
      subagents: {
        ...s.subagents,
        [sid]: (s.subagents[sid] ?? []).map((r) =>
          r.runId === runId && r.status === 'running'
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
      r.status === 'running' ? { ...r, status: 'done' as const, endedAt: Date.now() } : r
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
      usage: omitKey(s.usage, sid),
    })),
}))

// Per-session selectors, mirroring useAppState's useIsThreadActive — a
// component reading only one session's slice re-renders on that session's
// changes, not on every other session's.
export const useIsSessionActive = (sid: string | undefined) =>
  useCodeRun((s) => (sid ? s.runId[sid] != null : false))

export const useSessionHasPendingPerms = (sid: string | undefined) =>
  useCodeRun((s) => (sid ? (s.pendingPerms[sid]?.length ?? 0) > 0 : false))
