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

/** Cumulative tokens for a session, matching what the Rust loop enforced. */
export const MAX_SESSION_TOKENS = 200_000

export type BudgetState = {
  step: number
  sessionTokens: number
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
