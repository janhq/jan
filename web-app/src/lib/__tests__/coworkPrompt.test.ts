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
  memoryCatalog: [],
  ...over,
})

describe('buildCoworkSystemPrompt', () => {
  it('names the workspace as the writable directory', () => {
    const p = buildCoworkSystemPrompt(opts())
    expect(p).toContain('/data/agent-workspace/sessions/s1')
    expect(p).toContain('No project folder is attached')
  })

  // The shared folder is writable on this surface. The prompt has to say so —
  // a model that assumes read-only copies files into the sandbox and hands the
  // user stale duplicates — and to say it is real user data, since the
  // sandbox's anything-goes norms no longer apply.
  it('spells out that an attached folder is writable, in place, and real data', () => {
    const p = buildCoworkSystemPrompt(opts({ readOnlyFolder: '/home/u/repo' }))
    expect(p).toContain('/home/u/repo')
    expect(p).toMatch(/writable/i)
    expect(p).toMatch(/IN PLACE/)
    expect(p).toMatch(/real user\s+data/i)
    expect(p).not.toContain('READ-ONLY')
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

  // Progressive disclosure: one line per note, `memory_read` for the rest. An
  // empty store adds nothing, so the prompt prefix is unchanged for users who
  // never recorded a memory.
  it('lists memory notes with summaries only when the store has any', () => {
    const p = buildCoworkSystemPrompt(
      opts({
        memoryCatalog: [
          { name: 'decisions', summary: 'We use Yarn not npm.' },
          { name: 'empty-note', summary: '' },
        ],
      })
    )
    expect(p).toContain('# Available Memories')
    expect(p).toContain('- `decisions` - We use Yarn not npm.')
    expect(p).toContain('- `empty-note` - no summary')
    expect(p).toContain('memory_read')
    expect(buildCoworkSystemPrompt(opts())).not.toContain(
      '# Available Memories'
    )
  })

  it('states the environment when gathered and omits the block otherwise', () => {
    const p = buildCoworkSystemPrompt(
      opts({
        environment: {
          os: 'linux',
          arch: 'x86_64',
          appVersion: '0.7.0',
          locale: 'en-US',
          date: 'Tue Sep 02 2026',
        },
      })
    )
    expect(p).toContain('# Environment')
    expect(p).toContain('- OS: linux (x86_64)')
    expect(p).toContain('- App: Jan v0.7.0 (desktop)')
    expect(p).toContain("- Today's date: Tue Sep 02 2026")
    expect(p).toContain('- User locale: en-US')
    expect(buildCoworkSystemPrompt(opts())).not.toContain('# Environment')
  })

  // Web builds gather no OS or version; the block must not print empty lines.
  it('drops environment lines it has no value for', () => {
    const p = buildCoworkSystemPrompt(
      opts({
        environment: {
          os: null,
          arch: null,
          appVersion: null,
          locale: null,
          date: 'Tue Sep 02 2026',
        },
      })
    )
    expect(p).toContain("- Today's date: Tue Sep 02 2026")
    expect(p).not.toContain('- OS:')
    expect(p).not.toContain('- App:')
    expect(p).not.toContain('- User locale:')
  })

  it('encourages delegating long jobs to a subagent', () => {
    const p = buildCoworkSystemPrompt(opts({ subagentNames: ['researcher'] }))
    expect(p).toMatch(/prefer a subagent for long or repetitive jobs/i)
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
    expect(out).toContain('/home/me/repo')
    expect(out).toMatch(/writable/i)
  })

  it('states the three things a child cannot do', () => {
    const out = buildSubagentSystemPrompt('p', opts)
    expect(out).toContain('cannot see the conversation')
    expect(out).toContain('cannot ask the user')
    expect(out).toContain('cannot dispatch')
  })

  it('never leaks plan mode, a subagent roster, or memory into a child', () => {
    const out = buildSubagentSystemPrompt('p', opts)
    expect(out).not.toContain('PLAN MODE')
    expect(out).not.toContain('# Subagents')
    // A child runs one stated errand; recall is the dispatcher's job.
    expect(out).not.toContain('# Available Memories')
  })

  // A child runs shell commands on the same machine, so it gets the same facts.
  it('carries the environment through to a child when gathered', () => {
    const out = buildSubagentSystemPrompt('p', {
      ...opts,
      environment: {
        os: 'macos',
        arch: 'aarch64',
        appVersion: '0.7.0',
        locale: 'en-US',
        date: 'Tue Sep 02 2026',
      },
    })
    expect(out).toContain('# Environment')
    expect(out).toContain('- OS: macos (aarch64)')
    expect(buildSubagentSystemPrompt('p', opts)).not.toContain('# Environment')
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
