/* eslint-disable @typescript-eslint/no-explicit-any */
import type { UIMessage, UIMessageChunk } from 'ai'
import type { AskAnswer, CoworkTurn, Usage } from '@/types/coworkSession'
import {
  MAX_AGENT_STEPS,
  budgetExceeded,
  newSpend,
  recordSpend,
  type BudgetStop,
} from '@/lib/coworkBudget'
import { attachPings } from '@/lib/coworkPing'

/**
 * The Cowork agent loop.
 *
 * Deliberately not `useChat`: that binds one Chat per session through React, and
 * a Cowork run has to survive with no component mounted so a background session
 * keeps streaming while another is viewed. The handle map below lives outside
 * React for the same reason — route unmount must not abort a run.
 *
 * The loop is also ours because the AI SDK cannot own it here: Jan's tools are
 * declared without an `execute`, so `streamText` returns after one step and
 * `stopWhen` never evaluates. Every step boundary, and every cap, is explicit.
 */

/** A tool call the model made, awaiting dispatch. */
export type PendingToolCall = {
  toolCallId: string
  toolName: string
  input: unknown
}

export type ToolOutcome = {
  /** Sent to the model. */
  output: string
  isError?: boolean
  /** Display-only unified diff. Never reaches the model. */
  diff?: string
}

/** One model turn's worth of stream, folded into a shape the loop can act on. */
export type StepResult = {
  text: string
  /** Natively streamed reasoning (`reasoning-delta` chunks), accumulated apart
   * from `text`: the answer text becomes wire-history `content`, and reasoning
   * must never travel there inline. Inline `<think>` reasoning is different --
   * it IS the content the model sent -- and stays in `text`. */
  reasoning: string
  toolCalls: PendingToolCall[]
  usage: Usage | null
  errorText?: string
  aborted: boolean
}

export type RunHandle = {
  runId: string
  outer: AbortController
  tools: AbortController
  subagents: Map<string, AbortController>
  pendingAsks: Map<string, (answers: AskAnswer[] | null) => void>
}

const handles = new Map<string, RunHandle>()

export function getRunHandle(sid: string): RunHandle | undefined {
  return handles.get(sid)
}

export function isRunning(sid: string): boolean {
  return handles.has(sid)
}

function createHandle(sid: string, runId: string): RunHandle {
  const handle: RunHandle = {
    runId,
    outer: new AbortController(),
    tools: new AbortController(),
    subagents: new Map(),
    pendingAsks: new Map(),
  }
  handles.set(sid, handle)
  return handle
}

/**
 * Stop a session's run: the model stream, the tool dispatch loop, every nested
 * subagent, and any question the user was being asked.
 *
 * An in-flight `bash` cannot be cancelled — `execute_tool` is a plain `invoke`
 * with no cancellation token — so its result is discarded and the process runs
 * to completion.
 */
export function abortRun(sid: string, reason = 'cancelled'): void {
  const handle = handles.get(sid)
  if (!handle) return
  handle.outer.abort(reason)
  handle.tools.abort(reason)
  for (const child of handle.subagents.values()) child.abort(reason)
  handle.subagents.clear()
  // Reject rather than hang: an unanswered ask would otherwise keep its
  // promise, and the dispatch loop awaiting it, alive forever.
  for (const resolve of handle.pendingAsks.values()) resolve(null)
  handle.pendingAsks.clear()
  handles.delete(sid)
}

/**
 * Whether a rejection means "the user stopped this", not "this failed".
 *
 * Needed because the abort does not arrive as an `AbortError`: Jan streams
 * through `@tauri-apps/plugin-http`, whose `fetch` rejects with a plain
 * `Error('Request cancelled')` when the signal fires. Matched exactly rather
 * than by substring — "connection aborted" is a network failure and must keep
 * being reported as one.
 */
export function isAbortLike(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (e instanceof Error && e.name === 'AbortError') return true
  const message = (e instanceof Error ? e.message : String(e)).trim()
  return /^(request cancelled|the operation was aborted\.?|the user aborted a request\.?)$/i.test(
    message
  )
}

/**
 * True when a failed send can be retried safely: the connection died before any
 * response arrived, so nothing has been streamed and no upstream side effect is
 * implied. Port of the Rust agent's `is_retryable_send_error` — the failure a
 * long turn invites is a keep-alive connection the peer (or its load balancer)
 * reclaimed while tools ran locally, reported on the *next* request. Matched on
 * text because the tauri http plugin and the AI SDK both surface transport
 * failures as message strings. Timeouts are excluded on purpose: retrying one
 * doubles the wait.
 */
export function isRetryableSendError(message: string): boolean {
  const msg = message.toLowerCase()
  if (msg.includes('timed out') || msg.includes('timeout')) return false
  const markers = [
    // hyper reports a pooled connection the peer had already closed as the
    // first of these; the rest are the io errors an RST mid-request produces.
    'connection closed before message completed',
    'connection reset',
    'broken pipe',
    'connection aborted',
    'unexpected eof',
    // A refused or failed connect: reqwest via the tauri http plugin, and the
    // browser fetch in the web build.
    'connection refused',
    'error sending request',
    'failed to fetch',
    'fetch failed',
  ]
  return markers.some((m) => msg.includes(m))
}

/** Long enough for a load balancer that just recycled a backend to finish,
 * short enough that the user does not read it as a hang. */
const SEND_RETRY_DELAY_MS = 250

/** Settle a pending `ask`. Returns false when the request is already gone. */
export function answerAsk(
  sid: string,
  requestId: string,
  answers: AskAnswer[] | null
): boolean {
  const handle = handles.get(sid)
  const resolve = handle?.pendingAsks.get(requestId)
  if (!handle || !resolve) return false
  handle.pendingAsks.delete(requestId)
  resolve(answers)
  return true
}

const usageOf = (meta: unknown): Usage | null => {
  const u = (meta as { usage?: Record<string, unknown> } | undefined)?.usage
  if (!u || typeof u !== 'object') return null
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
  return {
    prompt_tokens: num(u.inputTokens ?? u.promptTokens ?? u.prompt_tokens),
    completion_tokens: num(
      u.outputTokens ?? u.completionTokens ?? u.completion_tokens
    ),
    total_tokens: num(u.totalTokens ?? u.total_tokens),
  }
}

export type StreamSink = {
  onText: (delta: string) => void
  /** A natively streamed reasoning fragment. Dropping these is not an option:
   * unlike inline `<think>` they never reach `onText`, so a sink without this
   * would show nothing at all while the model thinks. */
  onReasoning: (delta: string) => void
  onToolStart: (toolCallId: string, toolName: string) => void
  onToolArgsDelta: (toolCallId: string, delta: string) => void
  onToolCall: (call: PendingToolCall) => void
}

/**
 * Fold one `sendMessages` stream into a `StepResult`, reporting progress as it
 * goes. Reading to completion is what makes tool dispatch safe: results land on
 * a finished assistant message, never interleaved with one still streaming.
 */
export async function consumeStep(
  stream: ReadableStream<UIMessageChunk>,
  sink: StreamSink
): Promise<StepResult> {
  const reader = stream.getReader()
  const result: StepResult = {
    text: '',
    reasoning: '',
    toolCalls: [],
    usage: null,
    aborted: false,
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value as any
      switch (chunk.type) {
        case 'text-delta':
          result.text += chunk.delta
          sink.onText(chunk.delta)
          break
        case 'reasoning-delta':
          result.reasoning += chunk.delta
          sink.onReasoning(chunk.delta)
          break
        case 'tool-input-start':
          sink.onToolStart(chunk.toolCallId, chunk.toolName)
          break
        case 'tool-input-delta':
          sink.onToolArgsDelta(chunk.toolCallId, chunk.inputTextDelta)
          break
        case 'tool-input-available': {
          const call: PendingToolCall = {
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          }
          result.toolCalls.push(call)
          sink.onToolCall(call)
          break
        }
        case 'error':
          result.errorText = chunk.errorText
          break
        case 'abort':
          result.aborted = true
          break
        case 'finish':
          result.usage = usageOf(chunk.messageMetadata) ?? result.usage
          break
        default:
          break
      }
    }
  } finally {
    reader.releaseLock()
  }
  return result
}

/** Assemble the assistant message for a completed step, results included. */
export function assistantMessageFor(
  id: string,
  step: StepResult,
  outcomes: Map<string, ToolOutcome>
): UIMessage {
  const parts: any[] = []
  // Before the text part, matching emission order -- and as a `reasoning` part,
  // the same shape chat threads persist, so the transport treats it the same.
  if (step.reasoning) parts.push({ type: 'reasoning', text: step.reasoning })
  if (step.text) parts.push({ type: 'text', text: step.text })
  for (const call of step.toolCalls) {
    const outcome = outcomes.get(call.toolCallId)
    const part: any = {
      type: `tool-${call.toolName}`,
      toolCallId: call.toolCallId,
      input: call.input,
      state: outcome
        ? outcome.isError
          ? 'output-error'
          : 'output-available'
        : 'input-available',
    }
    if (outcome) {
      if (outcome.isError) part.errorText = outcome.output
      else part.output = outcome.output
    }
    parts.push(part)
  }
  return { id, role: 'assistant', parts } as UIMessage
}

/** Transcript rows for a completed step, for the Cowork run store. */
export function turnsFor(
  step: StepResult,
  outcomes: Map<string, ToolOutcome>
): CoworkTurn[] {
  const turns: CoworkTurn[] = []
  // A reasoning-only step (thought, then straight to a tool call) still gets a
  // row: its reasoning would otherwise vanish from the committed transcript.
  if (step.text || step.reasoning) {
    turns.push({
      role: 'assistant',
      content: step.text,
      ...(step.reasoning ? { reasoning: step.reasoning } : {}),
    })
  }
  for (const call of step.toolCalls) {
    const outcome = outcomes.get(call.toolCallId)
    turns.push({
      role: 'tool',
      content: '',
      callId: call.toolCallId,
      name: call.toolName,
      args: call.input,
      result: outcome?.output ?? '',
      isError: outcome?.isError,
      diff: outcome?.diff,
      status: outcome ? 'done' : 'running',
    })
  }
  return turns
}

export type RunDeps = {
  /** One model turn. Returns the raw UI message stream. */
  sendStep: (
    messages: UIMessage[],
    signal: AbortSignal
  ) => Promise<ReadableStream<UIMessageChunk>>
  /** Run one tool call. Must resolve, never reject. */
  dispatch: (call: PendingToolCall, signal: AbortSignal) => Promise<ToolOutcome>
  sink: StreamSink
  /** Called once per completed step with everything that step produced. */
  onStep: (info: {
    step: number
    result: StepResult
    turns: CoworkTurn[]
    outcomes: Map<string, ToolOutcome>
  }) => void
  /** Monotonic ids for the assistant messages this run appends. */
  nextMessageId: () => string
  /**
   * Pings from work the model started and is no longer blocked on: a
   * backgrounded subagent finishing. Omitted by a child run, which cannot
   * dispatch subagents of its own.
   */
  inbox?: {
    take: () => string[]
    pending: () => boolean
    wait: () => Promise<void>
  }
}

export type RunOutcome = {
  messages: UIMessage[]
  steps: number
  usage: Usage | null
  sessionTokens: number
  stoppedBy: BudgetStop | 'error' | 'aborted' | 'done'
  errorText?: string
}

/**
 * Drive one user request to completion.
 *
 * Continues while the last step asked for tools, which is the only signal that
 * more work is pending. Stops cleanly on a cap rather than throwing: hitting the
 * step budget is routine on a long task, and the caller offers "Keep going".
 */
export async function runTurn(opts: {
  messages: UIMessage[]
  deps: RunDeps
  signal: AbortSignal
  maxSteps?: number
  /** Tokens already spent by this session, which the caps apply across. */
  sessionTokens?: number
}): Promise<RunOutcome> {
  const { deps, signal } = opts
  const maxSteps = opts.maxSteps ?? MAX_AGENT_STEPS
  const messages = [...opts.messages]
  let step = 0
  // Not a running sum of each step's `total_tokens`: every step replays the whole
  // conversation, so summing totals charges the same context once per step.
  let spend = newSpend(opts.sessionTokens ?? 0)
  let usage: Usage | null = null

  for (;;) {
    if (signal.aborted) {
      return {
        messages,
        steps: step,
        usage,
        sessionTokens: spend.spent,
        stoppedBy: 'aborted',
      }
    }
    const overBudget = budgetExceeded(
      { step, sessionTokens: spend.spent },
      maxSteps
    )
    if (overBudget) {
      return {
        messages,
        steps: step,
        usage,
        sessionTokens: spend.spent,
        stoppedBy: overBudget,
      }
    }

    // Anything that finished since the last request reaches the model here, as
    // a marked user turn rather than an invented tool result: nothing was
    // called this step.
    attachPings(messages, deps.inbox?.take() ?? [])

    // A snapshot, not the live array: the loop pushes to `messages` after the
    // stream is handed over, and the transport rewrites what it is given
    // (trimming, compaction) without expecting it to move underneath.
    let result: StepResult
    let retried = false
    for (;;) {
      // Any sink activity means bytes reached the UI; replaying the request
      // would duplicate them, so a retry is only safe while this stays false.
      let received = false
      const sink: StreamSink = {
        onText: (d) => {
          received = true
          deps.sink.onText(d)
        },
        // Reasoning bytes on screen count as received too: replaying the
        // request after them would duplicate the thinking block.
        onReasoning: (d) => {
          received = true
          deps.sink.onReasoning(d)
        },
        onToolStart: (id, name) => {
          received = true
          deps.sink.onToolStart(id, name)
        },
        onToolArgsDelta: (id, d) => {
          received = true
          deps.sink.onToolArgsDelta(id, d)
        },
        onToolCall: (c) => {
          received = true
          deps.sink.onToolCall(c)
        },
      }
      try {
        const stream = await deps.sendStep([...messages], signal)
        result = await consumeStep(stream, sink)
      } catch (e) {
        if (isAbortLike(e, signal)) {
          return {
            messages,
            steps: step,
            usage,
            sessionTokens: spend.spent,
            stoppedBy: 'aborted',
          }
        }
        const errorText = e instanceof Error ? e.message : String(e)
        if (!retried && !received && isRetryableSendError(errorText)) {
          retried = true
          console.warn(`[coworkRunner] ${errorText} — retrying once`)
          await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS))
          continue
        }
        // A transport failure is an outcome, not an exception: throwing here
        // left the caller with no steps, no usage and nothing to render but
        // the raw message, and a user-initiated stop arrived down this path.
        return {
          messages,
          steps: step,
          usage,
          sessionTokens: spend.spent,
          stoppedBy: 'error',
          errorText,
        }
      }
      // A dropped connection can also surface as an error chunk — streamText
      // reports transport failures through the stream — so an error that
      // arrived before anything else gets the same single retry.
      if (
        !retried &&
        !received &&
        result.usage === null &&
        !result.aborted &&
        !signal.aborted &&
        result.errorText !== undefined &&
        isRetryableSendError(result.errorText)
      ) {
        retried = true
        console.warn(`[coworkRunner] ${result.errorText} — retrying once`)
        await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS))
        continue
      }
      break
    }
    step += 1
    if (result.usage) {
      usage = result.usage
      spend = recordSpend(spend, result.usage)
    }

    if (result.errorText) {
      // Only when the step produced something: an assistant message with no
      // parts is a turn the model never took, and it would be replayed as one.
      if (result.text || result.toolCalls.length > 0) {
        messages.push(
          assistantMessageFor(deps.nextMessageId(), result, new Map())
        )
      }
      deps.onStep({
        step,
        result,
        turns: turnsFor(result, new Map()),
        outcomes: new Map(),
      })
      return {
        messages,
        steps: step,
        usage,
        sessionTokens: spend.spent,
        stoppedBy: 'error',
        errorText: result.errorText,
      }
    }

    // One at a time: tools share a workspace, and the progress attribution in
    // the UI assumes a single call in flight. A `task` fan-out is not an
    // exception any more and needs none -- each `task` call returns as soon as
    // its child has started, so the children overlap whatever this loop does.
    const outcomes = new Map<string, ToolOutcome>()
    for (const call of result.toolCalls) {
      if (signal.aborted) {
        outcomes.set(call.toolCallId, {
          output: '(interrupted)',
          isError: true,
        })
        continue
      }
      outcomes.set(call.toolCallId, await deps.dispatch(call, signal))
    }

    if (result.text || result.toolCalls.length > 0) {
      messages.push(assistantMessageFor(deps.nextMessageId(), result, outcomes))
    }
    deps.onStep({ step, result, turns: turnsFor(result, outcomes), outcomes })

    if (result.aborted || signal.aborted) {
      return {
        messages,
        steps: step,
        usage,
        sessionTokens: spend.spent,
        stoppedBy: 'aborted',
      }
    }
    // No tool calls means the model answered rather than asked for more work.
    if (result.toolCalls.length === 0) {
      // Unless a subagent it dispatched is still going: ending here would drop
      // that answer on the floor. Park, then let the ping drained at the top of
      // the next step resume the conversation. Re-checked after the wait, which
      // also returns on cancellation.
      if (deps.inbox?.pending()) {
        await deps.inbox.wait()
        if (signal.aborted) {
          return {
            messages,
            steps: step,
            usage,
            sessionTokens: spend.spent,
            stoppedBy: 'aborted',
          }
        }
        if (deps.inbox.pending()) continue
      }
      return {
        messages,
        steps: step,
        usage,
        sessionTokens: spend.spent,
        stoppedBy: 'done',
      }
    }
  }
}

export const __testing = { handles, createHandle }
