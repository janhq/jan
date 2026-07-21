import { create } from 'zustand'
import type { CodeTurn, SubagentRun } from '@/hooks/useCodeSessions'
import type { PendingPermission } from '@/containers/dialogs/CodePermissionDialog'

// StreamEvent shapes emitted by the Rust agent loop (events.rs, tag = "type").
// Owned here because this store is what consumes/dispatches them.
export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'step'; index: number; max: number }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; content: string; is_error: boolean; diff?: string }
  | { type: 'done'; stop_reason: string; usage: unknown }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'permission_request'
      request_id: string
      tool_name: string
      capability: string
      path?: string
      command?: string
      diff?: string
      prompt_kind: string
      offers_always: boolean
    }
  | { type: 'subagent_start'; run_id: string; name: string }
  | { type: 'subagent_end'; run_id: string; name: string }
  | { type: 'subagent'; run_id: string; name: string; event: StreamEvent }

// Apply one wrapped inner subagent event to that subagent's own turn lane
// (token append / tool_call push / tool_result merge). Pure.
function applyInnerToTurns(turns: CodeTurn[], inner: StreamEvent): CodeTurn[] {
  switch (inner.type) {
    case 'token': {
      const last = turns[turns.length - 1]
      if (last && last.role === 'assistant')
        return [...turns.slice(0, -1), { ...last, content: last.content + inner.text }]
      return [...turns, { role: 'assistant', content: inner.text }]
    }
    case 'tool_call':
      return [
        ...turns,
        {
          role: 'tool',
          content: '',
          callId: inner.id,
          name: inner.name,
          args: inner.args,
          status: 'running',
        },
      ]
    case 'tool_result': {
      const idx = turns.findIndex((tn) => tn.role === 'tool' && tn.callId === inner.id)
      if (idx === -1) return turns
      return [
        ...turns.slice(0, idx),
        {
          ...turns[idx],
          result: inner.content,
          isError: inner.is_error,
          diff: inner.diff,
          status: 'done',
        },
        ...turns.slice(idx + 1),
      ]
    }
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
type CodeRunState = {
  running: Record<string, boolean>
  liveTurns: Record<string, CodeTurn[]>
  subagents: Record<string, SubagentRun[]>
  runId: Record<string, string>
  awaitCallToRunId: Record<string, Record<string, string>>
  pendingPerms: Record<string, PendingPermission[]>

  beginRun: (sid: string, runId: string, userText: string) => void
  appendToken: (sid: string, text: string) => void
  pushToolTurn: (sid: string, turn: CodeTurn) => void
  updateToolTurn: (sid: string, callId: string, patch: Partial<CodeTurn>) => void
  startSubagent: (sid: string, runId: string, name: string) => void
  endSubagent: (sid: string, runId: string) => void
  routeIntoSubagent: (sid: string, runId: string, inner: StreamEvent) => void
  attachSubagentOutput: (sid: string, runId: string, content: string) => void
  recordAwait: (sid: string, callId: string, runId: string) => void
  addPendingPerm: (sid: string, perm: PendingPermission) => void
  removePendingPerm: (sid: string, requestId: string) => void
  // Mark running tool turns + subagents done (interrupted), append an error turn
  // if the run failed, and flip running off. Leaves liveTurns/subagents in place
  // so the caller can commit them before clearCodeRun.
  finalizeRun: (sid: string, errorMessage: string | null) => void
  clearCodeRun: (sid: string) => void
}

export const useCodeRun = create<CodeRunState>()((set) => ({
  running: {},
  liveTurns: {},
  subagents: {},
  runId: {},
  awaitCallToRunId: {},
  pendingPerms: {},

  beginRun: (sid, runId, userText) =>
    set((s) => ({
      running: { ...s.running, [sid]: true },
      runId: { ...s.runId, [sid]: runId },
      liveTurns: { ...s.liveTurns, [sid]: [{ role: 'user', content: userText }] },
      subagents: { ...s.subagents, [sid]: [] },
      awaitCallToRunId: { ...s.awaitCallToRunId, [sid]: {} },
      pendingPerms: { ...s.pendingPerms, [sid]: [] },
    })),

  appendToken: (sid, text) =>
    set((s) => {
      const turns = s.liveTurns[sid] ?? []
      const last = turns[turns.length - 1]
      const next =
        last && last.role === 'assistant'
          ? [...turns.slice(0, -1), { ...last, content: last.content + text }]
          : [...turns, { role: 'assistant' as const, content: text }]
      return { liveTurns: { ...s.liveTurns, [sid]: next } }
    }),

  pushToolTurn: (sid, turn) =>
    set((s) => ({
      liveTurns: { ...s.liveTurns, [sid]: [...(s.liveTurns[sid] ?? []), turn] },
    })),

  updateToolTurn: (sid, callId, patch) =>
    set((s) => {
      const turns = s.liveTurns[sid] ?? []
      const idx = turns.findIndex((tn) => tn.role === 'tool' && tn.callId === callId)
      if (idx === -1) return {}
      return {
        liveTurns: {
          ...s.liveTurns,
          [sid]: [
            ...turns.slice(0, idx),
            { ...turns[idx], ...patch },
            ...turns.slice(idx + 1),
          ],
        },
      }
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

  endSubagent: (sid, runId) =>
    set((s) => ({
      subagents: {
        ...s.subagents,
        [sid]: (s.subagents[sid] ?? []).map((r) =>
          r.runId === runId && r.status === 'running'
            ? { ...r, status: 'done' as const, endedAt: Date.now() }
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

  recordAwait: (sid, callId, runId) =>
    set((s) => ({
      awaitCallToRunId: {
        ...s.awaitCallToRunId,
        [sid]: { ...(s.awaitCallToRunId[sid] ?? {}), [callId]: runId },
      },
    })),

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

  finalizeRun: (sid, errorMessage) =>
    set((s) => {
      let turns: CodeTurn[] = (s.liveTurns[sid] ?? []).map((tn) =>
        tn.role === 'tool' && tn.status === 'running'
          ? { ...tn, status: 'done' as const, isError: true, result: tn.result || '(interrupted)' }
          : tn
      )
      if (errorMessage) {
        turns = [
          ...turns,
          {
            role: 'tool',
            content: '',
            name: 'error',
            result: errorMessage,
            isError: true,
            status: 'done',
          },
        ]
      }
      const subs = (s.subagents[sid] ?? []).map((r) =>
        r.status === 'running' ? { ...r, status: 'done' as const, endedAt: Date.now() } : r
      )
      return {
        running: { ...s.running, [sid]: false },
        liveTurns: { ...s.liveTurns, [sid]: turns },
        subagents: { ...s.subagents, [sid]: subs },
      }
    }),

  clearCodeRun: (sid) =>
    set((s) => ({
      running: omitKey(s.running, sid),
      liveTurns: omitKey(s.liveTurns, sid),
      subagents: omitKey(s.subagents, sid),
      runId: omitKey(s.runId, sid),
      awaitCallToRunId: omitKey(s.awaitCallToRunId, sid),
      pendingPerms: omitKey(s.pendingPerms, sid),
    })),
}))
