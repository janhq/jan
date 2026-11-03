import type { LanguageModel, Tool, UIMessage } from 'ai'
import { runTurn, type PendingToolCall, type StreamSink, type ToolOutcome } from './coworkRunner'
import { recordSpend } from './coworkBudget'
import {
  SubagentInbox,
  formatDispatchedPlan,
  parentToolNames,
  parseDispatchPlan,
  planCompletionNotice,
  resolveSubagent,
  childStep,
  runDispatchPlan,
  subagentCompletionNotice,
  type SubagentRequest,
} from './coworkSubagent'
import { chatChildTools } from './chatChildTools'
import { unadvertisedToolRefusal } from './coworkTools'
import { MonitorLane, monitorSpecFromArgs, parseMonitorId } from './coworkMonitor'
import { useMonitorNotices } from '@/stores/monitor-notice-store'
import {
  listThreadAgentMonitors,
  startThreadAgentMonitor,
  stopAllThreadAgentMonitors,
  stopThreadAgentMonitor,
  type MonitorUpdate,
} from './agentTools'
import { onConversationThreadDropped } from './conversationClientTools'
import { intersectConversationCapabilities } from './scopedToolDispatch'
import type { ChatRunInbox, ChatToolOutcome } from './chatRunTransport'

/** Hard bounds for a Chat child. Parent grant stays the ceiling; these only cut. */
export const CHAT_CHILD_MAX_STEPS = 12
/** Soft per-child spend ceiling, in `recordSpend` units: new completion tokens
 * plus positive prompt GROWTH (not replayed history). It is checked only
 * BETWEEN steps (runTurn's pre-step gate), never mid-request: no per-request
 * token cap is sent to the provider, so one step can overshoot it. */
export const CHAT_CHILD_MAX_SPEND_TOKENS = 50_000
/** @deprecated misnomer (spend includes prompt growth); kept as an alias. */
export const CHAT_CHILD_MAX_COMPLETION_TOKENS = CHAT_CHILD_MAX_SPEND_TOKENS
/** Soft ceiling on ALL children started under one parent run signal, in the
 * same units. The per-child cap alone allowed 6 x 50k outside any accounting;
 * this is an explicit finite sum. It is separate from the parent's own
 * MAX_SESSION_TOKENS: child spend is never added to the parent's counter, and
 * the parent's counter never relaxes this one. Like the per-child cap it is a
 * between-steps gate, so each in-flight step (at most
 * CHAT_MAX_CONCURRENT_CHILDREN) may overshoot it once. */
export const CHAT_CHILD_AGGREGATE_SPEND_TOKENS = 150_000
export const CHAT_MAX_CONCURRENT_CHILDREN = 2
export const CHAT_MAX_CHILDREN_PER_CALL = 3
export const CHAT_MAX_CHILDREN_PER_THREAD_RUN = 6

/** Canonical structured task status. The `done` shape is exactly the row the
 * contextual task panel's contract accepts (runId, name, status, startedAt,
 * endedAt, finalOutput?); `running`/`error` rows are additive and ignored by
 * that parser until it learns them. Emitted as a `data-task-status` UI part. */
export type TaskStatusRow = {
  runId: string
  name: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  endedAt?: number
  finalOutput?: string
  error?: string
}

type ThreadState = {
  /** Status rows not yet handed to the run stream (dispatch + completion). */
  statusQueue: TaskStatusRow[]
  statusRows: Map<string, TaskStatusRow>
  inbox: SubagentInbox
  lane: MonitorLane
  monitorIds: Set<string>
  children: Set<AbortController>
  active: number
  waiters: Array<() => void>
  spawned: WeakMap<AbortSignal, number>
  /** Aggregate child spend per parent run signal (all of its children). */
  childSpend: WeakMap<AbortSignal, { spent: number }>
  /** Status row ids started under each run's signal (scopes per-run settling). */
  runRows: WeakMap<AbortSignal, Set<string>>
  /** Bumped by Stop/delete; monitor callbacks from an older epoch never ping. */
  epoch: number
}

const threads = new Map<string, ThreadState>()

const stateOf = (threadId: string): ThreadState => {
  let state = threads.get(threadId)
  if (!state) {
    state = {
      statusQueue: [],
      statusRows: new Map(),
      inbox: new SubagentInbox(),
      lane: new MonitorLane(),
      monitorIds: new Set(),
      children: new Set(),
      active: 0,
      waiters: [],
      spawned: new WeakMap(),
      childSpend: new WeakMap(),
      runRows: new WeakMap(),
      epoch: 0,
    }
    threads.set(threadId, state)
  }
  return state
}

/** The ONE inbox lane runTurn drains for a Chat thread: child completion
 * notices (SubagentInbox) and monitor pings (MonitorLane). No second loop. */
export function chatRunInbox(threadId: string): ChatRunInbox {
  const { inbox, lane } = stateOf(threadId)
  return {
    take: () => [...inbox.take(), ...lane.take()].map((n) => n.text),
    takeStatus: () => takeTaskStatus(threadId),
    // A running monitor never parks a run; only owed child work / queued pings.
    pending: () => inbox.pending() || lane.hasQueued(),
    wait: (signal) =>
      Promise.race([inbox.wait(signal), lane.wait(signal)]),
  }
}

/** Rows changed since the last call, each a copy (never a live reference). */
export function takeTaskStatus(threadId: string): TaskStatusRow[] {
  const state = threads.get(threadId)
  if (!state || !state.statusQueue.length) return []
  return state.statusQueue.splice(0).map((row) => ({ ...row }))
}

/** Persisted into the transcript, so child text is bounded (UTF-16 code units,
 * marker included: the result is never longer than the limit). */
export const TASK_STATUS_TEXT_LIMIT = 100_000
export const TASK_STATUS_TRUNCATION_MARKER = '\n\n[truncated: output exceeded 100000 characters]'

/** Cut to at most `limit` UTF-16 units ending in `marker`, never leaving half
 * of a surrogate pair at the cut. Text within the limit is returned as is. */
export function truncateUtf16(value: string, limit: number, marker: string): string {
  if (value.length <= limit) return value
  let keep = Math.max(0, limit - marker.length)
  const last = value.charCodeAt(keep - 1)
  // A trailing high surrogate here is the first half of a pair (or lone): drop it.
  if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep -= 1
  return value.slice(0, keep) + marker.slice(0, limit)
}

const bound = (value: string | undefined): string | undefined =>
  value === undefined ? value : truncateUtf16(value, TASK_STATUS_TEXT_LIMIT, TASK_STATUS_TRUNCATION_MARKER)

function recordStatus(state: ThreadState, row: TaskStatusRow): void {
  const bounded: TaskStatusRow = { ...row }
  if (bounded.finalOutput !== undefined) bounded.finalOutput = bound(bounded.finalOutput)
  if (bounded.error !== undefined) bounded.error = bound(bounded.error)
  state.statusRows.set(bounded.runId, bounded)
  state.statusQueue.push({ ...bounded })
}

const CANCELLED_ROW_ERROR = '(the subagent was cancelled)'
const AGGREGATE_EXHAUSTED = 'This turn\'s subagents already used their shared token budget; no new subagent was started'

/** Synchronously turn still-`running` rows into terminal `error` rows, so the
 * final status flush never persists a child as running after its run ended.
 * `signal` scopes it to one run; omitted = every run of the thread (Stop). */
function settleRunningRows(state: ThreadState, signal?: AbortSignal): void {
  const owned = signal ? state.runRows.get(signal) : undefined
  if (signal && !owned) return
  const endedAt = Date.now()
  for (const row of [...state.statusRows.values()]) {
    if (row.status !== 'running' || (owned && !owned.has(row.runId))) continue
    recordStatus(state, { ...row, status: 'error', endedAt, error: CANCELLED_ROW_ERROR })
  }
}

/** Per-run final cleanup (error/budget/stop/done), called from the run's
 * onFinally BEFORE its snapshot is released (so no newer turn can exist yet):
 * abort any child still held and make every row terminal. Does not bump the
 * epoch or stop monitors, so a monitor that outlives the turn keeps pinging. */
export function settleChatRun(threadId: string): void {
  const state = threads.get(threadId)
  if (!state) return
  for (const child of [...state.children]) child.abort('Chat run finished')
  settleRunningRows(state)
}

/** What a child is bounded by, frozen when `task` was dispatched: the parent's
 * grant (a ceiling, never re-read upward) and the parent's MCP/native identity
 * per advertised tool name. A later widen cannot enlarge a child; a later
 * revoke still narrows it (the route intersects with the CURRENT grant). */
export type ChildBinding = {
  ceiling: unknown
  mcpServers: ReadonlyMap<string, string | undefined>
}

export type ChatOrchestrationContext = {
  threadId: string
  /** The run's signal; children and monitor ownership hang off it. */
  signal: AbortSignal
  /** The parent's frozen advertised record for this run. */
  getParentTools: () => Record<string, Tool>
  getModel: () => LanguageModel | null
  /** The parent's effective grant right now; read ONCE at task dispatch. */
  readGrant: () => unknown
  /** The parent's frozen MCP server (or undefined = native) for a tool name. */
  serverFor: (toolName: string) => string | undefined
  /** The route's single full dispatch (same threadId, per-call grant, same
   * native/MCP approval stores). Children never get a separate executor and
   * always pass the frozen binding so the route bounds the call by it. */
  dispatch: (call: PendingToolCall, signal: AbortSignal, child: ChildBinding) => Promise<ChatToolOutcome>
}

/** The grant a child call is classified and executed under: the CURRENT grant
 * intersected with the parent's grant frozen at dispatch. */
export const childEffectiveGrant = (current: unknown, binding: ChildBinding): unknown =>
  intersectConversationCapabilities(current, binding.ceiling)

const text = (output: unknown): string =>
  typeof output === 'string' ? output : JSON.stringify(output ?? '')

/** Take a child slot, or resolve null if `signal` aborts first. An aborted
 * waiter removes itself from the queue; a slot handed to a waiter is owned by
 * the returned release (call exactly once-safe). */
export function acquire(state: Pick<ThreadState, 'active' | 'waiters'>, signal: AbortSignal): Promise<(() => void) | null> {
  if (signal.aborted) return Promise.resolve(null)
  const make = () => {
    let done = false
    return () => {
      if (done) return
      done = true
      const next = state.waiters.shift()
      if (next) next() // slot handed over; active unchanged
      else state.active -= 1
    }
  }
  if (state.active < CHAT_MAX_CONCURRENT_CHILDREN) {
    state.active += 1
    return Promise.resolve(make())
  }
  return new Promise((resolve) => {
    const grant = () => {
      signal.removeEventListener('abort', onAbort)
      resolve(make())
    }
    const onAbort = () => {
      const i = state.waiters.indexOf(grant)
      if (i >= 0) state.waiters.splice(i, 1)
      resolve(null)
    }
    state.waiters.push(grant)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function runChild(
  ctx: ChatOrchestrationContext,
  state: ThreadState,
  req: SubagentRequest,
  description: string,
  id: string,
  childTools: Record<string, Tool>,
  system: string,
  model: LanguageModel | null,
  binding: ChildBinding,
  ledger: { spent: number }
): Promise<{ output: string; usage: null; isError?: boolean; sessionTokens: number }> {
  const controller = new AbortController()
  state.children.add(controller)
  const abort = () => controller.abort(ctx.signal.reason)
  if (ctx.signal.aborted) abort()
  else ctx.signal.addEventListener('abort', abort, { once: true })
  let release: (() => void) | null = null
  try {
    release = await acquire(state, controller.signal)
    if (!release || controller.signal.aborted || !model) {
      return { output: model ? '(cancelled)' : 'No model is available for the subagent', usage: null, isError: true, sessionTokens: 0 }
    }
    // Nothing new starts once the aggregate is spent (e.g. a queued child that
    // only got its slot after its siblings used the budget).
    if (ledger.spent >= CHAT_CHILD_AGGREGATE_SPEND_TOKENS) {
      return { output: AGGREGATE_EXHAUSTED, usage: null, isError: true, sessionTokens: 0 }
    }
    let finalText = ''
    let n = 0
    const outcome = await runTurn({
      messages: [{ id: 'sub-user-0', role: 'user', parts: [{ type: 'text', text: description }] } as UIMessage],
      signal: controller.signal,
      maxSteps: CHAT_CHILD_MAX_STEPS,
      budgetPolicy: {
        // Pre-step gate (the only place a cap applies): own spend or the
        // run-wide child aggregate. Charged in `record` below, per step.
        exceeded: ({ step, sessionTokens }, maxSteps) =>
          step >= maxSteps
            ? 'steps'
            : sessionTokens >= CHAT_CHILD_MAX_SPEND_TOKENS || ledger.spent >= CHAT_CHILD_AGGREGATE_SPEND_TOKENS
              ? 'tokens'
              : null,
        record: (state, usage) => {
          const next = recordSpend(state, usage)
          ledger.spent += Math.max(0, next.spent - state.spent)
          return next
        },
      },
      deps: {
        sendStep: (messages, signal) =>
          childStep({ model, system, tools: childTools, messages, signal }),
        // Narrowed record is enforced BEFORE the route dispatch; the route then
        // applies the same per-call grant, classification and approval stores
        // to a unique child call id (so a parent allow-once never transfers).
        dispatch: async (call, signal) => {
          const refusal = unadvertisedToolRefusal(call.toolName, childTools)
          if (refusal) return refusal
          const outcome = await ctx.dispatch({ ...call, toolCallId: `${id}:${call.toolCallId}` }, signal, binding)
          return { ...outcome, output: text(outcome.output) }
        },
        sink: { onText() {}, onReasoning() {}, onToolStart() {}, onToolArgsDelta() {}, onToolCall() {} } as StreamSink,
        onStep: ({ result }) => {
          if (result.text.trim()) finalText = result.text
        },
        nextMessageId: () => `sub-asst-${n++}`,
      },
    })
    if (outcome.stoppedBy === 'error') return { output: outcome.errorText ?? 'the subagent failed', usage: null, isError: true, sessionTokens: outcome.sessionTokens }
    if (outcome.stoppedBy === 'aborted') return { output: '(the subagent was cancelled)', usage: null, isError: true, sessionTokens: outcome.sessionTokens }
    if (outcome.stoppedBy === 'steps' || outcome.stoppedBy === 'tokens') {
      const cap =
        outcome.stoppedBy === 'steps'
          ? `its ${CHAT_CHILD_MAX_STEPS}-step budget`
          : ledger.spent >= CHAT_CHILD_AGGREGATE_SPEND_TOKENS && outcome.sessionTokens < CHAT_CHILD_MAX_SPEND_TOKENS
            ? 'the subagents\' shared token budget'
            : 'its token budget'
      return {
        output: `The subagent '${req.name}' stopped at ${cap} without finishing.` + (finalText ? `\n\nIts last output was:\n${finalText}` : ''),
        usage: null,
        isError: true,
        sessionTokens: outcome.sessionTokens,
      }
    }
    return { output: finalText || '(the subagent returned no answer)', usage: null, sessionTokens: outcome.sessionTokens }
  } finally {
    release?.()
    ctx.signal.removeEventListener('abort', abort)
    state.children.delete(controller)
  }
}

/** Chat `task`: validate, narrow, and start bounded children in the
 * background. Completion rides the thread inbox (runTurn's lane). */
export async function runChatTask(input: unknown, callId: string, ctx: ChatOrchestrationContext): Promise<ToolOutcome> {
  const plan = parseDispatchPlan(input)
  if (typeof plan === 'string') return { output: plan, isError: true }
  const state = stateOf(ctx.threadId)
  const parentTools = ctx.getParentTools()
  const total = plan.phases.reduce((n, p) => n + p.subagents.length, 0)
  if (total > CHAT_MAX_CHILDREN_PER_CALL) {
    return { output: `\`task\` accepts at most ${CHAT_MAX_CHILDREN_PER_CALL} subagents per call`, isError: true }
  }
  const ledger = state.childSpend.get(ctx.signal) ?? { spent: 0 }
  state.childSpend.set(ctx.signal, ledger)
  // No new task spend after the aggregate cap: refuse before resolving or starting anything.
  if (ledger.spent >= CHAT_CHILD_AGGREGATE_SPEND_TOKENS) return { output: AGGREGATE_EXHAUSTED, isError: true }
  const spent = state.spawned.get(ctx.signal) ?? 0
  if (spent + total > CHAT_MAX_CHILDREN_PER_THREAD_RUN) {
    return { output: `This turn already started its limit of ${CHAT_MAX_CHILDREN_PER_THREAD_RUN} subagents`, isError: true }
  }
  // Resolve every child up front: an allowlist conflict refuses the whole call.
  const resolved = new Map<string, { tools: Record<string, Tool>; system: string }>()
  for (const phase of plan.phases) {
    for (const req of phase.subagents) {
      const r = resolveSubagent(req, [], parentToolNames(parentTools))
      if ('error' in r) return { output: r.error, isError: true }
      resolved.set(req.name, { tools: chatChildTools(parentTools, r.allowedTools), system: r.systemPrompt })
    }
  }
  // Frozen NOW: grant ceiling, MCP identities, model. Nothing re-read later.
  const frozenGrant = ctx.readGrant()
  const binding: ChildBinding = {
    ceiling: intersectConversationCapabilities(frozenGrant, frozenGrant),
    // Only names some resolved child may call (withheld memory/task/todo/ask/
    // monitor are already absent), each with the parent's frozen identity.
    mcpServers: new Map(
      [...new Set([...resolved.values()].flatMap((r) => Object.keys(r.tools)))].map((n) => [n, ctx.serverFor(n)] as const)
    ),
  }
  const model = ctx.getModel()
  state.spawned.set(ctx.signal, spent + total)
  if (!state.runRows.has(ctx.signal)) {
    state.runRows.set(ctx.signal, new Set())
    // Registered before any child's own abort listener: when the run ends on ANY
    // path the rows are terminal synchronously, before the final status flush.
    ctx.signal.addEventListener('abort', () => settleRunningRows(state, ctx.signal), { once: true })
  }
  const multi = plan.phases.length > 1
  const { inbox } = state
  inbox.begin() // plan hold: pending() never reads false mid-plan
  void (async () => {
    try {
      const finalPhase = await runDispatchPlan(plan, callId, {
        signal: ctx.signal,
        runOne: (req, description, id) => {
          const r = resolved.get(req.name)!
          return runChild(ctx, state, req, description, id, r.tools, r.system, model, binding, ledger)
        },
        writeBlackboard: async () => null,
        onDispatch: (id, name) => {
          inbox.begin()
          if (threads.get(ctx.threadId) === state && !ctx.signal.aborted) {
            state.runRows.get(ctx.signal)?.add(id)
            recordStatus(state, { runId: id, name, status: 'running', startedAt: Date.now() })
          }
        },
        onComplete: (id, name, result) => {
          const began = state.statusRows.get(id)
          if (began?.status === 'running' && threads.get(ctx.threadId) === state && !ctx.signal.aborted) {
            const endedAt = Date.now()
            recordStatus(
              state,
              result.isError
                ? { runId: id, name, status: 'error', startedAt: began.startedAt, endedAt, error: result.output }
                : { runId: id, name, status: 'done', startedAt: began.startedAt, endedAt, finalOutput: result.output }
            )
          }
          // A stopped/deleted run has nobody to tell; never leave a stale ping.
          if (multi || ctx.signal.aborted || threads.get(ctx.threadId) !== state) return inbox.abandon()
          inbox.finish(subagentCompletionNotice({ name, callId: id, savedPath: null, output: result.output, isError: result.isError }))
        },
      })
      if (multi && !ctx.signal.aborted && threads.get(ctx.threadId) === state) {
        inbox.note(planCompletionNotice({ phaseCount: plan.phases.length, totalSubagents: total, finalPhase }))
      }
    } catch {
      // runDispatchPlan never throws; the hold is released below regardless.
    } finally {
      inbox.abandon()
    }
  })()
  return { output: formatDispatchedPlan(plan, null) }
}

/** Chat `monitor`: native thread APIs only (threadId, args, onUpdate). The host
 * resolves the CURRENT grant each poll; nothing here supplies roots or flags. */
export async function runChatMonitor(input: unknown, ctx: Pick<ChatOrchestrationContext, 'threadId' | 'signal'>): Promise<ToolOutcome> {
  const state = stateOf(ctx.threadId)
  const args = (input ?? {}) as { op?: unknown; monitor_id?: unknown }
  const op = typeof args.op === 'string' ? args.op : ''
  if (op === 'start') {
    if (ctx.signal.aborted) return { output: 'ERROR: the run was stopped', isError: true }
    const epoch = state.epoch
    const early = new Set<string>()
    const started = await startThreadAgentMonitor(ctx.threadId, input, (update: MonitorUpdate) => {
      // Stopped/deleted since start: this callback is stale and must not ping.
      if (state.epoch !== epoch || threads.get(ctx.threadId) !== state) return
      early.add(update.monitorId)
      state.monitorIds.delete(update.monitorId)
      // Same MonitorLane the Cowork route uses; drained only by runTurn's inbox.
      state.lane.update(update)
      // Display-only notice (no authority, no run, no inbox drain). The epoch
      // guard above already dropped stale/deleted-thread callbacks.
      useMonitorNotices.getState().publish({
        threadId: ctx.threadId,
        monitorId: update.monitorId,
        headline: update.headline,
        text: update.text,
      })
    })
    if (state.epoch !== epoch || threads.get(ctx.threadId) !== state) {
      // Stop/delete landed while the host was starting: do not leak the monitor.
      const id = parseMonitorId(started.output)
      if (!started.isError && id) void stopThreadAgentMonitor(ctx.threadId, id).catch(() => {})
      return { output: 'ERROR: the run was stopped', isError: true }
    }
    if (!started.isError) {
      const id = parseMonitorId(started.output)
      // An update that already fired ended this monitor; do not track it as open.
      if (!id || !early.has(id)) {
        state.lane.started(started.output, monitorSpecFromArgs(input))
        if (id) state.monitorIds.add(id)
      }
    }
    return { output: started.output, isError: started.isError }
  }
  if (op === 'stop') {
    const id = typeof args.monitor_id === 'string' ? args.monitor_id : ''
    const result = await stopThreadAgentMonitor(ctx.threadId, id)
    state.lane.stopped(id, result)
    if (!result.startsWith('ERROR')) state.monitorIds.delete(id)
    return { output: result, isError: result.startsWith('ERROR') }
  }
  if (op === 'list') return { output: await listThreadAgentMonitors(ctx.threadId) }
  return { output: `ERROR: unknown monitor op '${op}'`, isError: true }
}

/** Stop: abort children and stop only the monitors this thread's lane owns. */
export async function cancelChatOrchestration(threadId: string, opts: { monitors: boolean } = { monitors: true }): Promise<void> {
  const state = threads.get(threadId)
  if (!state) return
  state.epoch += 1
  settleRunningRows(state)
  for (const child of [...state.children]) child.abort('Chat run stopped')
  if (!opts.monitors) return
  const ids = [...state.monitorIds]
  state.monitorIds.clear()
  await Promise.all(ids.map((id) => stopThreadAgentMonitor(threadId, id).catch(() => {})))
}

/** Thread deletion: cancel children, stop every host monitor, forget state. */
onConversationThreadDropped((threadId) => {
  const state = threads.get(threadId)
  if (!state) return
  void cancelChatOrchestration(threadId, { monitors: false })
  void stopAllThreadAgentMonitors(threadId)
  useMonitorNotices.getState().clearThread(threadId)
  state.waiters.length = 0
  threads.delete(threadId)
})

export const __testing = { threads, stateOf }
