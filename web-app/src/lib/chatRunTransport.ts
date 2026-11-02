import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { runTurn, type PendingToolCall, type ToolOutcome, type RunOutcome } from './coworkRunner'
import { STOPPED_TOOL_ERROR, untilAborted } from './stopped-tool-calls'
import { CHAT_RUN_NOTICE_METADATA } from './chatRunNotice'
import { encodeToolImageSentinel } from './tool-image-sentinel'

export type ChatToolOutcome = Omit<ToolOutcome, 'output'> & { output: unknown }

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
}): ReadableStream<UIMessageChunk> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal.reason)
  if (options.signal.aborted) abort()
  else options.signal.addEventListener('abort', abort, { once: true })
  let consumerCancelled = false
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
      let canonical: UIMessage | undefined
      let completed: UIMessage | undefined
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
          sendStep: async (_messages, signal) => {
            canonical = undefined
            // SDK Chat displays/persists one assistant across all tool waves.
            // Send that same history, not runTurn's per-step Cowork projection.
            const messages = completed ? [...options.messages, completed] : options.messages
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
            for (const [toolCallId, outcome] of outcomes) {
              const chatOutcome = chatOutcomes.get(toolCallId) ?? outcome
              emit(outcome.isError
                ? { type: 'tool-output-error', toolCallId, errorText: String(chatOutcome.output) }
                : { type: 'tool-output-available', toolCallId, output: outputOf(chatOutcome) })
            }
          },
        },
      }).then(outcome => {
        notify(outcome)
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
        emit({ type: 'error', errorText })
      }).finally(() => {
        options.signal.removeEventListener('abort', abort)
        try { options.onFinally?.() } finally { if (!consumerCancelled) output.close() }
      })
    },
    cancel(reason) { consumerCancelled = true; controller.abort(reason) },
  })
}

