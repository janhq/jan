import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { TOOL_DIFF_MAX_CHARS } from './toolDiff'
import { runTurn, type PendingToolCall, type ToolOutcome, type RunOutcome } from './coworkRunner'
import { STOPPED_TOOL_ERROR, untilAborted } from './stopped-tool-calls'
import { CHAT_RUN_NOTICE_METADATA, isChatRunNotice } from './chatRunNotice'
import { encodeToolImageSentinel } from './tool-image-sentinel'
import { PING_OPEN, PING_CLOSE } from './coworkPing'
import { RUN_CONTEXT_PART, boundRunContextText } from './chatRunContext'

/** The existing runTurn inbox lane (SubagentInbox/MonitorLane pings), as text. */
export type ChatRunInbox = {
  take: () => string[]
  pending: () => boolean
  wait: (signal: AbortSignal) => Promise<void>
  onParked?: (parked: boolean) => void
  /** Structured task dispatch/completion rows since the last call. Surfaced as
   * `data-task-status` UI parts (id per run, so a later row replaces the
   * earlier one); never replayed to the model. */
  takeStatus?: () => unknown[]
  /** Per-run cleanup of everything the run owns (status rows/queue). Called
   * once after the final status flush, also when the consumer cancels, and
   * before `onFinally`. Must be idempotent. */
  finalize?: () => void
}

export const TASK_STATUS_PART = 'data-task-status'

/** Latest status row per run from persisted `data-task-status` parts, in the
 * shape lib/conversationPanels.ts (contextual-panels workspace, read-only
 * reference) accepts for `done` rows: { runId, name, status, startedAt,
 * endedAt, finalOutput? }. `running`/`error` rows are kept for dispatch
 * visibility; the panels parser currently reads only settled `task` TOOL
 * output, so it must adopt this carrier before a panel shows them. */
export function taskStatusRows(messages: readonly UIMessage[]): Array<Record<string, unknown>> {
  const runs = new Map<string, Record<string, unknown>>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.type !== TASK_STATUS_PART) continue
      const rows = ((part as { data?: { subagents?: unknown } }).data?.subagents ?? []) as unknown[]
      for (const row of Array.isArray(rows) ? rows : []) {
        const r = row as Record<string, unknown> | null
        if (!r || typeof r.runId !== 'string' || !r.runId || typeof r.name !== 'string' || !r.name) continue
        if (r.status !== 'running' && r.status !== 'done' && r.status !== 'error') continue
        if (typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt)) continue
        runs.set(r.runId, r)
      }
    }
  }
  return [...runs.values()]
}

export type ChatToolOutcome = Omit<ToolOutcome, 'output'> & { output: unknown }

/** The user turn a capped run resumes with. The capped assistant (tool calls
 * and results included) stays canonical history, so nothing re-executes. */
export const CAPPED_CONTINUE_INSTRUCTION = 'Continue.'

/** Whether a stopped turn ended on this adapter's step/token cap. */
export function isCappedTurn(metadata: unknown): boolean {
  const reason = (metadata as { runStopReason?: unknown } | undefined)?.runStopReason
  return reason === 'steps' || reason === 'tokens'
}

/** A tool part whose execution already settled (result or stop/error marked). */
const isSettledToolPart = (part: UIMessage['parts'][number]): boolean =>
  'toolCallId' in part &&
  ((part as { state?: string }).state === 'output-available' ||
    (part as { state?: string }).state === 'output-error')

/** A stopped turn resumes from kept canonical history (a new user continue
 * turn) whenever regenerate-plus-prefill could lose settled work and make the
 * model re-issue it: any cap, or any settled tool wave in the turn. A pure
 * text/reasoning stop keeps the seamless prefill path. A tool still in flight
 * does not qualify — the defensive mid-run race stays on the prefill path. */
export function resumesFromKeptHistory(
  metadata: unknown,
  parts: UIMessage['parts']
): boolean {
  return isCappedTurn(metadata) || parts.some(isSettledToolPart)
}

/** Continue eligibility for the message UI, mirroring the route's working
 * paths: a capped turn resumes from any substantive part, any stopped turn
 * resumes from settled tool waves (kept history) or partial text/reasoning,
 * and an in-flight tool is not a resume point. The cap notice itself never
 * qualifies. The route handler does not call this: it stays tolerant of the
 * stop-stamp race and branches on resumesFromKeptHistory alone. */
export function canContinueStoppedTurn(
  metadata: unknown,
  parts: UIMessage['parts']
): boolean {
  if ((metadata as { stopped?: unknown } | undefined)?.stopped !== true) return false
  const capped = isCappedTurn(metadata)
  return parts.some((part) => {
    if (isChatRunNotice(part)) return false
    if (part.type === 'text' || part.type === 'reasoning') return !!part.text?.trim()
    return capped ? 'toolCallId' in part : isSettledToolPart(part)
  })
}

/** A turn-local adapter. It owns no grants or discovery: the caller supplies
 * the existing Chat executor and a transport whose prompt/schema are frozen.
 * SDK Chat consumes this stream once; only runTurn requests further steps. */
export function createChatRunStream(options: {
  messages: UIMessage[]
  messageId: string
  signal: AbortSignal
  sendStep: (messages: UIMessage[], signal: AbortSignal) => Promise<ReadableStream<UIMessageChunk>>
  dispatch: (call: PendingToolCall, signal: AbortSignal) => Promise<ChatToolOutcome>
  onToolCall?: (call: PendingToolCall) => void
  onOutcome?: (outcome: RunOutcome) => void
  onFinally?: () => void
  maxSteps?: number
  /** Selected model context; prompt replay is not generated-token spend. */
  modelContextTokens?: number
  getModelContextTokens?: () => number | undefined
  /** Child completions and monitor pings; consumed ONLY by runTurn's inbox. */
  inbox?: ChatRunInbox | ((runSignal: AbortSignal) => ChatRunInbox | undefined)
}): ReadableStream<UIMessageChunk> {
  const controller = new AbortController()
  // A factory is bound to THIS controller's signal: the very signal runTurn
  // hands to `dispatch` (and so to child tasks/monitors), never the outer one.
  const inbox = typeof options.inbox === 'function' ? options.inbox(controller.signal) : options.inbox
  const abort = () => controller.abort(options.signal.reason)
  if (options.signal.aborted) abort()
  else options.signal.addEventListener('abort', abort, { once: true })
  let consumerCancelled = false
  let finalized = false
  const finalizeRun = () => {
    if (finalized) return
    finalized = true
    inbox?.finalize?.()
  }
  return new ReadableStream<UIMessageChunk>({
    start(output) {
      const emit = (chunk: UIMessageChunk) => {
        if (!consumerCancelled) output.enqueue(chunk)
      }
      const chatOutcomes = new Map<string, ChatToolOutcome>()
      const outputOf = (outcome: ChatToolOutcome): unknown => {
        if (!outcome.images?.length) return outcome.output
        if (typeof outcome.output !== 'string') throw new Error('Tool image sentinels require a string output')
        return outcome.output + outcome.images.map(image => encodeToolImageSentinel(image.dataUrl)).join('')
      }
      let contextTokens = options.modelContextTokens
      let protocolError: unknown
      let outcomeNotified = false
      const notify = (outcome: RunOutcome) => {
        if (protocolError) outcome = { ...outcome, stoppedBy: 'error', errorText: protocolError instanceof Error ? protocolError.message : String(protocolError) }
        if (outcomeNotified) return
        outcomeNotified = true
        options.onOutcome?.(outcome)
      }
      const flushTaskStatus = () => {
        for (const row of inbox?.takeStatus?.() ?? []) {
          const runId = (row as { runId?: unknown }).runId
          if (typeof runId !== 'string') continue
          emit({ type: TASK_STATUS_PART, id: `task-status:${runId}`, data: { subagents: [row] } } as UIMessageChunk)
        }
      }
      // Every terminal path (done, error, budget cap, stop, throw) ends the run's
      // controller FIRST: children hang off this signal, and their listeners
      // synchronously settle running rows as terminal before the final flush.
      const endRun = (reason: string) => { if (!controller.signal.aborted) controller.abort(reason) }
      let canonical: UIMessage | undefined
      let completed: UIMessage | undefined
      // Pings runTurn drained from the inbox. runTurn folds them into its own
      // (ignored) projection, so they are replayed here as marked user turns
      // after the canonical history; they are never persisted as transcript.
      const pingMarks: { at: number; message: UIMessage }[] = []
      const withPings = (): UIMessage[] => {
        if (!completed) return [...options.messages, ...pingMarks.map(m => m.message)]
        const out = [...options.messages]
        let from = 0
        for (const mark of pingMarks) {
          if (mark.at > from) out.push({ ...completed, parts: completed.parts.slice(from, mark.at) })
          out.push(mark.message)
          from = Math.max(from, mark.at)
        }
        out.push(from === 0 ? completed : { ...completed, parts: completed.parts.slice(from) })
        return out.filter(m => m.role !== 'assistant' || m.parts.length > 0)
      }
      let step = 0
      const seenCalls = new Set<string>()
      const id = options.messageId
      emit({ type: 'start', messageId: id })
      void runTurn({
        messages: options.messages,
        signal: controller.signal,
        maxSteps: options.maxSteps,
        budgetPolicy: {
          exceeded: ({ step, sessionTokens }, maxSteps) => step >= maxSteps
            ? 'steps'
            : contextTokens && sessionTokens >= contextTokens ? 'tokens' : null,
          record: (spend, usage) => ({ ...spend, spent: spend.spent + Math.max(0, usage?.completion_tokens ?? 0) }),
        },
        deps: {
          inbox: inbox && {
            take: () => {
              flushTaskStatus()
              const taken = inbox.take()
              flushTaskStatus()
              // Persisted copy for reload only (`expandChatRunContext`). Emitted to the
              // UI stream, never through the canonical `history` branch, so the live
              // run replays these pings once, from `pingMarks`.
              if (taken.length) emit({ type: RUN_CONTEXT_PART, data: { text: boundRunContextText(taken.join('\n')) } } as UIMessageChunk)
              if (taken.length) pingMarks.push({ at: completed?.parts.length ?? 0, message: { id: `${id}:ping:${pingMarks.length}`, role: 'user', parts: [{ type: 'text', text: `${PING_OPEN}\n${taken.join('\n')}\n${PING_CLOSE}` }] } as UIMessage })
              return taken
            },
            pending: () => inbox.pending(),
            wait: () => inbox.wait(controller.signal),
            onParked: inbox.onParked,
          },
          sendStep: async (_messages, signal) => {
            canonical = undefined
            // SDK Chat displays/persists one assistant across all tool waves.
            // Send that same history, not runTurn's per-step Cowork projection.
            const messages = pingMarks.length ? withPings() : completed ? [...options.messages, completed] : options.messages
            const prefix = `${step++}:`
            const source = (await options.sendStep(messages, signal)).getReader()
            if (step === 1) {
              const selectedLimit = options.getModelContextTokens?.()
              if (selectedLimit && Number.isFinite(selectedLimit) && selectedLimit > 0) contextTokens = selectedLimit
            }
            // Abort the shared source, not one tee branch (whose cancellation
            // waits for the other branch and can strand the SDK parser).
            const cancelSource = () => { void source.cancel(signal.reason).catch(() => {}) }
            signal.addEventListener('abort', cancelSource, { once: true })
            if (signal.aborted) cancelSource()
            const bounded = new ReadableStream<UIMessageChunk>({
              async pull(target) {
                try {
                  const item = await source.read()
                  if (item.done) {
                    signal.removeEventListener('abort', cancelSource)
                    source.releaseLock()
                    target.close()
                  } else target.enqueue(item.value)
                } catch (error) {
                  signal.removeEventListener('abort', cancelSource)
                  target.error(error)
                }
              },
              cancel(reason) { signal.removeEventListener('abort', cancelSource); return source.cancel(reason) },
            })
            const [presentation, history] = bounded.tee()
            const parsed = (async () => {
              for await (const message of readUIMessageStream({ stream: history, terminateOnError: true, onError: error => { protocolError = error } })) canonical = message
            })()
            // Attach rejection immediately, including while the other branch is read.
            void parsed.catch(() => {})
            const reader = presentation.getReader()
            return new ReadableStream<UIMessageChunk>({
              async pull(target) {
                try {
                  const { done, value } = await reader.read()
                  if (done) {
                    await parsed
                    reader.releaseLock()
                    target.close()
                    return
                  }
                  if (value.type === 'tool-approval-request') {
                    throw new Error('SDK approvals are unsupported; Chat approvals own execution')
                  }
                  if (value.type === 'tool-input-available') {
                    if (seenCalls.has(value.toolCallId)) throw new Error(`Duplicate tool call id: ${value.toolCallId}`)
                    seenCalls.add(value.toolCallId)
                  }
                  if ((value.type === 'start' || value.type === 'finish') && value.messageMetadata) {
                    emit({ type: 'message-metadata', messageMetadata: value.messageMetadata })
                  }
                  if (value.type !== 'start' && value.type !== 'finish' && value.type !== 'abort' && value.type !== 'error') {
                    // Providers routinely reuse text/reasoning ids each request.
                    const chunk = 'id' in value ? { ...value, id: prefix + value.id } : value
                    emit(chunk as UIMessageChunk)
                  }
                  target.enqueue(value)
                } catch (error) {
                  protocolError = error
                  cancelSource()
                  target.error(error)
                }
              },
              cancel(reason) { return reader.cancel(reason) },
            })
          },
          dispatch: async (call, signal) => {
            let outcome: ChatToolOutcome
            try { outcome = await untilAborted(options.dispatch(call, signal), signal) }
            catch (error) { outcome = { output: signal.aborted ? STOPPED_TOOL_ERROR : error instanceof Error ? error.message : String(error), isError: true } }
            chatOutcomes.set(call.toolCallId, outcome)
            // runTurn only needs the error status here. Canonical typed results
            // are retained separately, never stringified for Chat history.
            return { ...outcome, output: typeof outcome.output === 'string' ? outcome.output : '' }
          },
          sink: {
            onText() {}, onReasoning() {}, onToolStart() {}, onToolArgsDelta() {},
            onToolCall(call) { options.onToolCall?.(call) },
          },
          nextMessageId: () => `${id}:step:${step}`,
          assistantMessage: (messageId, _result, outcomes) => {
            if (!canonical) throw new Error('Chat stream completed without canonical SDK message')
            const current: UIMessage = {
              ...canonical,
              id: messageId,
              parts: canonical.parts.map((part) => {
                if (!('toolCallId' in part)) return part
                const outcome = outcomes.get(part.toolCallId)
                if (!outcome) return part
                if (part.providerExecuted) return part
                if (part.state === 'approval-requested' || part.state === 'approval-responded' || part.state === 'output-denied') {
                  throw new Error('Unexpected SDK approval state in Chat executor')
                }
                const chatOutcome = chatOutcomes.get(part.toolCallId) ?? outcome
                return outcome.isError
                  ? { ...part, output: undefined, state: 'output-error' as const, errorText: String(chatOutcome.output) }
                  : { ...part, errorText: undefined, state: 'output-available' as const, output: outputOf(chatOutcome) }
              }),
            }
            completed = {
              ...current,
              id,
              metadata: { ...(completed?.metadata as Record<string, unknown>), ...(current.metadata as Record<string, unknown>) },
              parts: [...(completed?.parts ?? []), ...current.parts],
            }
            return current
          },
          onStep: ({ outcomes }) => {
            flushTaskStatus()
            for (const [toolCallId, outcome] of outcomes) {
              const chatOutcome = chatOutcomes.get(toolCallId) ?? outcome
              if (!outcome.isError && typeof chatOutcome.diff === 'string' && chatOutcome.diff.length <= TOOL_DIFF_MAX_CHARS) {
                emit({ type: 'data-tool-diff', id: `tool-diff:${toolCallId}`, data: { toolCallId, diff: chatOutcome.diff } })
              }
              emit(outcome.isError
                ? { type: 'tool-output-error', toolCallId, errorText: String(chatOutcome.output) }
                : { type: 'tool-output-available', toolCallId, output: outputOf(chatOutcome) })
            }
          },
        },
      }).then(outcome => {
        notify(outcome)
        endRun('Chat run ended')
        flushTaskStatus()
        if (outcome.stoppedBy === 'steps' || outcome.stoppedBy === 'tokens') {
          emit({ type: 'message-metadata', messageMetadata: { stopped: true, runStopReason: outcome.stoppedBy } })
          // Use the existing stopped-turn Continue presentation rather than
          // silently treating a capped tool turn as a successful answer.
          const capId = `cap:${step}`
          emit({ type: 'text-start', id: capId })
          emit({ type: 'text-delta', id: capId, delta: `\n\nStopped at the ${outcome.stoppedBy === 'steps' ? 'step' : 'token'} limit. You can continue this turn.` })
          emit({ type: 'text-end', id: capId, providerMetadata: CHAT_RUN_NOTICE_METADATA })
          emit({ type: 'abort' })
        }
        if (outcome.stoppedBy === 'error') emit({ type: 'error', errorText: outcome.errorText ?? 'Chat run failed' })
        else if (outcome.stoppedBy === 'aborted') emit({ type: 'abort' })
        emit({ type: 'finish' })
      }).catch(error => {
        const errorText = error instanceof Error ? error.message : String(error)
        notify({ messages: completed ? [...options.messages, completed] : options.messages, steps: step, usage: null, sessionTokens: 0, stoppedBy: controller.signal.aborted ? 'aborted' : 'error', errorText })
        endRun('Chat run failed')
        flushTaskStatus()
        emit({ type: 'error', errorText })
      }).finally(() => {
        endRun('Chat run ended')
        options.signal.removeEventListener('abort', abort)
        try {
          flushTaskStatus()
        } finally {
          try { finalizeRun() } finally {
            try { options.onFinally?.() } finally { if (!consumerCancelled) output.close() }
          }
        }
      })
    },
    cancel(reason) {
      consumerCancelled = true
      controller.abort(reason)
      // Nobody is left to flush to: still purge this run's owned rows now.
      finalizeRun()
    },
  })
}

