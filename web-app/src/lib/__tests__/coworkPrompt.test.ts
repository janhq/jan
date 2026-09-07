import { describe, it, expect } from 'vitest'
import {
  buildCoworkSystemPrompt,
  buildSubagentSystemPrompt,
  PLAN_REVIEW_QUESTION_ID,
} from '../coworkPrompt'

const opts = (over = {}) => ({
  workspacePath: '/data/agent-workspace/sessions/s1',
  readOnlyFolder: null,
  planMode: false,
  webSearch: false,
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

describe('buildSubagentSystemPrompt', () => {
  const opts = {
    workspacePath: '/ws/s1',
    readOnlyFolder: '/home/me/repo',
    bashAvailable: true,
  }

  it('keeps the definition prompt and adds the workspace facts', () => {
    const out = buildSubagentSystemPrompt('You review Rust.', opts)
    expect(out).toContain('You review Rust.')
    // The Rust `system_prompt_override` replaces the whole prompt, which works
    // for the CLI (cwd is the project) but leaves a desktop child unable to
    // guess its sandbox path.
    expect(out).toContain('/ws/s1')
    expect(out).toContain('READ-ONLY')
  })

  it('states the three things a child cannot do', () => {
    const out = buildSubagentSystemPrompt('p', opts)
    expect(out).toContain('cannot see the conversation')
    expect(out).toContain('cannot ask the user')
    expect(out).toContain('cannot dispatch')
  })

  it('never leaks plan mode or a subagent roster into a child', () => {
    const out = buildSubagentSystemPrompt('p', opts)
    expect(out).not.toContain('PLAN MODE')
    expect(out).not.toContain('# Subagents')
  })

  // A child whose allowlist dropped the web tools must not be told it has them.
  it('describes web access only when the child kept the tools', () => {
    expect(buildSubagentSystemPrompt('p', { ...opts, webSearch: true })).toContain(
      '# Web'
    )
    expect(buildSubagentSystemPrompt('p', opts)).not.toContain('# Web')
  })
})

describe('web block', () => {
  it('is absent when web search is off', () => {
    expect(buildCoworkSystemPrompt(opts())).not.toContain('# Web')
  })

  // The marker has to match chat's, or the renderer shows raw text instead of
  // source chips.
  it('names both tools and the citation marker when on', () => {
    const p = buildCoworkSystemPrompt(opts({ webSearch: true }))
    expect(p).toContain('web_search')
    expect(p).toContain('web_fetch')
    expect(p).toContain('[[cite:URL]]')
  })
})
