/**
 * Bounds on a Cowork run.
 *
 * The AI SDK cannot enforce these for us: Jan's tools are declared without an
 * `execute`, so `streamText` returns after a single step and its `stopWhen`
 * conditions never evaluate. The loop is the runner's, so the caps are too —
 * and without them an agent with real tools has no upper bound at all.
 */

/** Model turns in one user request. Generous: real work runs long. */
export const MAX_AGENT_STEPS = 100

/** Tighter for a nested run, which should be a focused errand. */
export const MAX_SUBAGENT_STEPS = 30

/**
 * Token spend for one user request, matching what the Rust loop enforced.
 *
 * Per request, not per session, because that is where `SessionBudget` actually
 * lives in Rust: it is constructed inside `run_orchestration_streamed`, so each
 * request gets its own allowance.
 */
export const MAX_SESSION_TOKENS = 200_000

export type BudgetState = {
  step: number
  sessionTokens: number
}

/**
 * Running spend, and what is needed to charge only the *new* tokens.
 *
 * `lastTotal`/`lastPrompt` exist because every step of an agent turn replays the
 * whole conversation, so each step's `total_tokens` includes the prompt again.
 * Summing those totals charges the same context 20+ times over and trips the cap
 * a few steps into a run that is nowhere near it.
 */
export type SpendState = {
  spent: number
  lastTotal: number
  lastPrompt?: number
}

export const newSpend = (spent = 0): SpendState => ({ spent, lastTotal: 0 })

/**
 * Fold one step's usage into the running spend.
 *
 * Charges new completion tokens plus positive prompt *growth*, not replayed
 * prompt history; the first step of a request uses its reported total as the
 * baseline. Falls back through progressively weaker signals because providers
 * omit different usage fields. Ported from `core/agent/session.rs::record`.
 */
export function recordSpend(
  state: SpendState,
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
): SpendState {
  if (!usage) return state
  const { prompt_tokens: prompt, completion_tokens: completion } = usage
  const total = usage.total_tokens
  const gap = (a: number, b: number) => Math.max(0, a - b)

  let delta: number
  let lastTotal = state.lastTotal
  if (total != null) {
    if (prompt != null && state.lastPrompt != null && completion != null) {
      delta = completion + gap(prompt, state.lastPrompt)
    } else if (prompt != null && state.lastPrompt == null) {
      delta = total
    } else if (state.lastPrompt != null && completion != null) {
      delta = Math.max(completion, gap(total, state.lastTotal))
    } else {
      delta = gap(total, state.lastTotal)
    }
    lastTotal = total
  } else {
    delta = completion ?? 0
  }

  return {
    spent: state.spent + delta,
    lastTotal,
    lastPrompt: prompt ?? state.lastPrompt,
  }
}

export type BudgetStop = 'steps' | 'tokens' | null

/** Which cap, if any, this run has reached. */
export function budgetExceeded(
  state: BudgetState,
  maxSteps: number = MAX_AGENT_STEPS
): BudgetStop {
  if (state.step >= maxSteps) return 'steps'
  if (state.sessionTokens >= MAX_SESSION_TOKENS) return 'tokens'
  return null
}
