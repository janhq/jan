import { describe, it, expect } from 'vitest'
import {
  budgetExceeded,
  MAX_AGENT_STEPS,
  MAX_SUBAGENT_STEPS,
  MAX_SESSION_TOKENS,
} from '../coworkBudget'

describe('budgetExceeded', () => {
  it('is null while under both caps', () => {
    expect(budgetExceeded({ step: 0, sessionTokens: 0 })).toBeNull()
    expect(
      budgetExceeded({ step: MAX_AGENT_STEPS - 1, sessionTokens: 0 })
    ).toBeNull()
  })

  it('reports the step cap at the boundary, not past it', () => {
    expect(budgetExceeded({ step: MAX_AGENT_STEPS, sessionTokens: 0 })).toBe(
      'steps'
    )
  })

  it('reports the token cap', () => {
    expect(
      budgetExceeded({ step: 0, sessionTokens: MAX_SESSION_TOKENS })
    ).toBe('tokens')
  })

  // Steps first: it is the cheaper one to explain and the one "Keep going"
  // can actually resolve, whereas the token cap needs a compact or a new
  // session.
  it('reports steps first when both are exceeded', () => {
    expect(
      budgetExceeded({
        step: MAX_AGENT_STEPS,
        sessionTokens: MAX_SESSION_TOKENS,
      })
    ).toBe('steps')
  })

  it('honours a caller-supplied cap, as a subagent uses', () => {
    expect(
      budgetExceeded({ step: MAX_SUBAGENT_STEPS, sessionTokens: 0 }, MAX_SUBAGENT_STEPS)
    ).toBe('steps')
    expect(
      budgetExceeded({ step: MAX_SUBAGENT_STEPS - 1, sessionTokens: 0 }, MAX_SUBAGENT_STEPS)
    ).toBeNull()
  })

  it('keeps a subagent on a tighter leash than the parent', () => {
    expect(MAX_SUBAGENT_STEPS).toBeLessThan(MAX_AGENT_STEPS)
  })
})
