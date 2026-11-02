import type { ClientToolHandlers, ToolOutcome } from './clientToolDispatch'
import { applyTodoOp, renderTodoResult } from './coworkTodo'
import { parseAskRequest, renderAskResult } from './coworkAsk'
import type {
  AskAnswer,
  AskRequestPayload,
  TodoList,
} from '@/types/coworkSession'

type AskResolver = (answers: AskAnswer[] | null) => void

/** Owned by one conversation's run. No ambient stores, permissions or executor.
 * Chat supplies its own transcript projection and UI callbacks, never Cowork's
 * store/grants. The registry is the existing runtime's suspension registry. */
export type ConversationToolContext = {
  signal: AbortSignal
  getTodo: () => TodoList | undefined
  onTodo: (list: TodoList, toolCallId?: string) => void
  pendingAsks: Map<string, AskResolver>
  showAsk: (id: string, request: AskRequestPayload) => void
  hideAsk: (id: string) => void
  /** Optional caller policy (e.g. Cowork plan review), not a grant here. */
  onAnswer?: (request: AskRequestPayload, answers: AskAnswer[] | null) => void
}

const cancelled = (): ToolOutcome => ({
  output: 'Cancelled: the conversation run was stopped.',
  isError: true,
})

export function createConversationToolHandlers(
  ctx: ConversationToolContext
): Pick<ClientToolHandlers, 'onTodo' | 'onAsk'> {
  // Only run-local settlement receipts, not a second transcript or todo store.
  const receipts = new Map<
    string,
    { kind: 'todo' | 'ask'; result: Promise<ToolOutcome>; settled: boolean }
  >()
  const once = (
    id: string,
    kind: 'todo' | 'ask',
    work: () => Promise<ToolOutcome>
  ) => {
    const previous = receipts.get(id)
    if (previous)
      return previous.kind === kind
        ? previous.settled
          ? Promise.resolve({
              output: 'ERROR: settled tool call id reused; use a fresh id',
              isError: true,
            })
          : previous.result
        : Promise.resolve({
            output: 'ERROR: tool call id reused for a different tool',
            isError: true,
          })
    // Register before callbacks can re-enter this handler.
    const result = Promise.resolve().then(work)
    const receipt = { kind, result, settled: false }
    receipts.set(id, receipt)
    // Reused settled IDs fail closed rather than replaying an old answer.
    void result.then(
      () => {
        receipt.settled = true
      },
      () => {
        receipt.settled = true
      }
    )
    return result
  }
  return {
    onTodo: (input, toolCallId) => {
      const apply = async (): Promise<ToolOutcome> => {
        if (ctx.signal.aborted) return cancelled()
        let result: ReturnType<typeof applyTodoOp>
        try {
          result = applyTodoOp(ctx.getTodo(), input)
        } catch {
          return { output: 'ERROR: malformed todo arguments', isError: true }
        }
        if (result.error)
          return { output: `ERROR: ${result.error}`, isError: true }
        ctx.onTodo(result.list, toolCallId)
        return { output: renderTodoResult(result.list) }
      }
      return toolCallId ? once(toolCallId, 'todo', apply) : apply()
    },
    onAsk: (id, input) =>
      once(id, 'ask', async () => {
        if (ctx.signal.aborted) return cancelled()
        const request = parseAskRequest(input)
        if (typeof request === 'string')
          return { output: `ERROR: ${request}`, isError: true }
        if (ctx.pendingAsks.has(id))
          return {
            output: 'ERROR: ask id already belongs to another suspension',
            isError: true,
          }
        return new Promise<ToolOutcome>((resolve, reject) => {
          let settled = false
          const finish = (answers: AskAnswer[] | null) => {
            if (settled) return
            if (
              !ctx.signal.aborted &&
              answers !== null &&
              !validAnswers(request, answers)
            ) {
              // Existing answerAsk removes the resolver before invoking it.
              if (!ctx.pendingAsks.has(id)) ctx.pendingAsks.set(id, finish)
              return
            }
            settled = true
            ctx.signal.removeEventListener('abort', abort)
            // A replaced suspension owns its own card and policy too. Absence
            // is legitimate: answerAsk deletes before calling the resolver.
            const owner = ctx.pendingAsks.get(id)
            if (owner && owner !== finish) {
              resolve(cancelled())
              return
            }
            if (owner === finish) ctx.pendingAsks.delete(id)
            try {
              ctx.hideAsk(id)
              const outcome = ctx.signal.aborted
                ? cancelled()
                : renderAskResult(answers)
              if (!ctx.signal.aborted) ctx.onAnswer?.(request, answers)
              resolve(outcome)
            } catch (error) {
              reject(error)
            }
          }
          const abort = () => finish(null)
          ctx.pendingAsks.set(id, finish)
          ctx.signal.addEventListener('abort', abort, { once: true })
          try {
            ctx.showAsk(id, request)
            if (ctx.signal.aborted) abort()
          } catch (error) {
            settled = true
            ctx.signal.removeEventListener('abort', abort)
            const owner = ctx.pendingAsks.get(id)
            if (!owner || owner === finish) {
              if (owner === finish) ctx.pendingAsks.delete(id)
              ctx.hideAsk(id)
            }
            reject(error)
          }
        })
      }),
  }
}

/** Invalid or stale UI payloads cannot resume a suspended model turn. */
function validAnswers(
  request: AskRequestPayload,
  answers: AskAnswer[]
): boolean {
  if (!Array.isArray(answers) || answers.length !== request.questions.length)
    return false
  const ids = new Set<string>()
  return answers.every((answer) => {
    if (!answer || typeof answer !== 'object' || ids.has(answer.id))
      return false
    ids.add(answer.id)
    const question = request.questions.find((q) => q.id === answer.id)
    if (!question || !Array.isArray(answer.selected)) return false
    if (
      answer.custom_input !== undefined &&
      typeof answer.custom_input !== 'string'
    )
      return false
    const custom = answer.custom_input?.trim()
    if (
      answer.custom_input !== undefined &&
      (!custom || answer.selected.length !== 0)
    )
      return false
    if (answer.selected.length === 0 && !custom) return false
    if (!question.multi && answer.selected.length > 1) return false
    return (
      new Set(answer.selected).size === answer.selected.length &&
      answer.selected.every((label) =>
        question.options.some((option) => option.label === label)
      )
    )
  })
}
