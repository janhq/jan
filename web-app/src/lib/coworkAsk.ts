import type {
  AskAnswer,
  AskQuestion,
  AskRequestPayload,
} from '@/types/coworkSession'
import type { ToolOutcome } from '@/lib/coworkRunner'

/**
 * The `ask` tool: suspend the run until the user answers.
 *
 * Because Cowork dispatches tools after the model stream has terminated, a
 * suspended ask holds no HTTP connection and occupies no llama.cpp slot while
 * the user thinks — unlike the Rust loop, which blocked inside the turn.
 */

const RECOMMENDED_SUFFIX = /\s*\(recommended\)\s*$/i

/** Reject a malformed request rather than rendering an unanswerable card. */
export function parseAskRequest(input: unknown): AskRequestPayload | string {
  const raw = (input ?? {}) as { questions?: unknown }
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    return '`ask` requires a non-empty `questions` array'
  }
  const questions: AskQuestion[] = []
  const ids = new Set<string>()
  for (const entry of raw.questions) {
    const q = entry as Partial<AskQuestion>
    if (typeof q.id !== 'string' || !q.id.trim()) {
      return 'each question requires a non-empty `id`'
    }
    // Answers are keyed by id, so a repeat would make two questions share one.
    if (ids.has(q.id)) return `duplicate question id '${q.id}'`
    ids.add(q.id)
    if (typeof q.question !== 'string' || !q.question.trim()) {
      return `question '${q.id}' requires a \`question\` string`
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return `question '${q.id}' requires at least two options`
    }
    let recommended =
      typeof q.recommended === 'number' && Number.isInteger(q.recommended)
        ? q.recommended
        : undefined
    const options: AskQuestion['options'] = []
    q.options.forEach((entry, i) => {
      const o = entry as { label?: unknown; description?: unknown }
      if (typeof o.label !== 'string' || !o.label.trim()) {
        // Dropping a blank option shifts the ones after it, so the
        // recommended index has to follow (or go, if it pointed here).
        if (recommended === i) recommended = undefined
        else if (recommended !== undefined && recommended > i) recommended--
        return
      }
      // Models trained on other harnesses mark a suggestion by suffixing the
      // label; read it as the field so the answer carries the clean label.
      const marked = RECOMMENDED_SUFFIX.exec(o.label)
      if (marked && recommended === undefined) recommended = options.length
      options.push({
        label: marked ? o.label.slice(0, marked.index) : o.label,
        ...(typeof o.description === 'string'
          ? { description: o.description }
          : {}),
      })
    })
    if (options.length < 2) {
      return `question '${q.id}' requires at least two labelled options`
    }
    // The answer names options by label, so two alike would be ambiguous.
    if (new Set(options.map((o) => o.label)).size !== options.length) {
      return `question '${q.id}' has duplicate option labels`
    }
    questions.push({
      id: q.id,
      question: q.question,
      options,
      ...(q.multi === true ? { multi: true } : {}),
      ...(recommended !== undefined &&
      recommended >= 0 &&
      recommended < options.length
        ? { recommended }
        : {}),
    })
  }
  return { questions }
}

/**
 * The tool result for a settled ask. `null` answers mean the user dismissed the
 * card or the run was aborted; the model is told so plainly rather than being
 * left to infer it from an empty array.
 */
const NOT_ANSWERED =
  'The user did not answer. Proceed with your best judgement, and do not ask again unless something new depends on it.'

export function renderAskResult(answers: AskAnswer[] | null): ToolOutcome {
  if (answers === null) return { output: NOT_ANSWERED }
  return { output: JSON.stringify(answers) }
}

/** One answered question as the transcript shows it; `answer` null = skipped. */
export type AskSummaryRow = { question: string; answer: string | null }

/**
 * Pair a settled ask's questions with its answers for the transcript, so the
 * user's choice stays visible after the card closes. Null when the part isn't
 * one this can read (e.g. a malformed request that never showed a card).
 */
export function summarizeAsk(
  input: unknown,
  output: unknown
): AskSummaryRow[] | null {
  const request = parseAskRequest(input)
  if (typeof request === 'string' || typeof output !== 'string') return null
  if (output === NOT_ANSWERED) {
    return request.questions.map((q) => ({
      question: q.question,
      answer: null,
    }))
  }
  let answers: AskAnswer[]
  try {
    answers = JSON.parse(output)
  } catch {
    return null
  }
  if (!Array.isArray(answers)) return null
  // Only a complete answer set is shown; a partial one would pass off the
  // missing rows as skips the user never made.
  const byId = new Map(answers.map((a) => [a?.id, a]))
  if (request.questions.some((q) => !byId.has(q.id))) return null
  return request.questions.map((q) => {
    const a = byId.get(q.id)
    const text = a?.custom_input?.trim() || a?.selected?.join(', ')
    return { question: q.question, answer: text || null }
  })
}
