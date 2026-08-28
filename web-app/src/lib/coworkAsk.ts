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

/** Reject a malformed request rather than rendering an unanswerable card. */
export function parseAskRequest(input: unknown): AskRequestPayload | string {
  const raw = (input ?? {}) as { questions?: unknown }
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    return '`ask` requires a non-empty `questions` array'
  }
  const questions: AskQuestion[] = []
  for (const entry of raw.questions) {
    const q = entry as Partial<AskQuestion>
    if (typeof q.id !== 'string' || !q.id.trim()) {
      return 'each question requires a non-empty `id`'
    }
    if (typeof q.question !== 'string' || !q.question.trim()) {
      return `question '${q.id}' requires a \`question\` string`
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return `question '${q.id}' requires at least two options`
    }
    const options = q.options
      .map((o) => o as { label?: unknown; description?: unknown })
      .filter((o) => typeof o.label === 'string' && o.label.trim())
      .map((o) => ({
        label: o.label as string,
        ...(typeof o.description === 'string'
          ? { description: o.description }
          : {}),
      }))
    if (options.length < 2) {
      return `question '${q.id}' requires at least two labelled options`
    }
    questions.push({
      id: q.id,
      question: q.question,
      options,
      ...(q.multi === true ? { multi: true } : {}),
      ...(typeof q.recommended === 'number' && q.recommended >= 0
        ? { recommended: q.recommended }
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
export function renderAskResult(answers: AskAnswer[] | null): ToolOutcome {
  if (answers === null) {
    return {
      output:
        'The user did not answer. Proceed with your best judgement, and do not ask again unless something new depends on it.',
    }
  }
  return { output: JSON.stringify(answers) }
}
