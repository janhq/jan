import { describe, it, expect } from 'vitest'
import {
  buildCoworkSystemPrompt,
  PLAN_REVIEW_QUESTION_ID,
} from '../coworkPrompt'

const opts = (over = {}) => ({
  workspacePath: '/data/agent-workspace/sessions/s1',
  readOnlyFolder: null,
  planMode: false,
  bashAvailable: true,
  subagentNames: [],
  ...over,
})

describe('buildCoworkSystemPrompt', () => {
  it('names the workspace as the writable directory', () => {
    const p = buildCoworkSystemPrompt(opts())
    expect(p).toContain('/data/agent-workspace/sessions/s1')
    expect(p).toContain('No project folder is attached')
  })

  // Without this the model retries the same refused write until the step
  // budget runs out — the single most expensive thing it can get wrong here.
  it('spells out that an attached folder is read-only and how to work around it', () => {
    const p = buildCoworkSystemPrompt(opts({ readOnlyFolder: '/home/u/repo' }))
    expect(p).toContain('/home/u/repo')
    expect(p).toContain('READ-ONLY')
    expect(p).toMatch(/copy it into your workspace/i)
    expect(p).toMatch(/Do not\s+retry a refused write/i)
  })

  it('explains a missing shell rather than staying silent about it', () => {
    const p = buildCoworkSystemPrompt(opts({ bashAvailable: false }))
    expect(p).toMatch(/Shell commands are unavailable/i)
    expect(buildCoworkSystemPrompt(opts())).not.toMatch(
      /Shell commands are unavailable/i
    )
  })

  it('carries the plan-review contract the ask card special-cases', () => {
    const p = buildCoworkSystemPrompt(opts({ planMode: true }))
    expect(p).toContain('PLAN MODE (read only)')
    expect(p).toContain(PLAN_REVIEW_QUESTION_ID)
    expect(p).toContain('Execute plan')
    expect(p).toContain('Keep planning')
    expect(p).toContain('Exit plan mode')
  })

  it('describes subagents only when some are available and not planning', () => {
    expect(
      buildCoworkSystemPrompt(opts({ subagentNames: ['researcher'] }))
    ).toContain('researcher')
    expect(
      buildCoworkSystemPrompt(
        opts({ subagentNames: ['researcher'], planMode: true })
      )
    ).not.toContain('# Subagents')
    expect(buildCoworkSystemPrompt(opts())).not.toContain('# Subagents')
  })
})
