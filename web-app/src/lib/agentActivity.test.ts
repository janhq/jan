import { describe, it, expect } from 'vitest'
import {
  toolActivityText,
  completedToolLabel,
  usedSkillNames,
  subagentActivityLabel,
  awaitsModel,
} from './agentActivity'
import type { SubagentRun } from '@/hooks/useCoworkSessions'
import type { CoworkTurn } from '@/types/coworkSession'

describe('toolActivityText', () => {
  it('formats write with basename only', () => {
    expect(toolActivityText('write', { path: '/a/b/report.html' })).toBe(
      'Writing report.html'
    )
  })

  it('formats edit with basename only', () => {
    expect(toolActivityText('edit', { path: 'src/config.ts' })).toBe(
      'Editing config.ts'
    )
  })
  it('formats write with Windows-style path basename only', () => {
    expect(
      toolActivityText('write', { path: 'C:\\Users\\x\\report.html' })
    ).toBe('Writing report.html')
  })

  it('formats bash with truncated command', () => {
    expect(toolActivityText('bash', { command: 'ls -la' })).toBe(
      'Running ls -la'
    )
  })

  it('truncates long bash commands to 60 chars', () => {
    const long = 'echo ' + 'x'.repeat(100)
    const text = toolActivityText('bash', { command: long })
    expect(text.startsWith('Running echo ')).toBe(true)
    expect(text.length).toBeLessThanOrEqual('Running '.length + 60)
  })

  it('formats read/ls/find/grep with basename', () => {
    expect(toolActivityText('read', { path: '/x/y.md' })).toBe('Reading y.md')
    expect(toolActivityText('ls', { path: '/x' })).toBe('Listing x')
    expect(toolActivityText('find', { path: '/x' })).toBe('Finding x')
    expect(toolActivityText('grep', { path: '/x' })).toBe('Searching x')
  })

  it('formats memory tools without a path', () => {
    expect(toolActivityText('memory_write', {})).toBe('Saving memory')
    expect(toolActivityText('memory_read', {})).toBe('Reading memory')
    expect(toolActivityText('memory_list', {})).toBe('Reading memory')
  })

  it('names the skill being read', () => {
    expect(toolActivityText('skill_read', { name: 'pptx' })).toBe(
      'Reading pptx'
    )
    expect(
      completedToolLabel('skill_read', { name: 'pptx' }, 'output-available')
    ).toBe('Used pptx')
  })

  it('falls back to humanized tool name for unknown tools', () => {
    expect(toolActivityText('web_search', { query: 'x' })).toBe('Web search')
  })

  it('falls back gracefully when path/command arg is missing', () => {
    expect(toolActivityText('write', {})).toBe('Writing')
    expect(toolActivityText('bash', {})).toBe('Running')
  })
})

describe('usedSkillNames', () => {
  it('returns unique successfully loaded skill names only', () => {
    expect(
      usedSkillNames([
        {
          type: 'tool-skill_read',
          state: 'output-available',
          input: { name: 'pptx' },
        },
        {
          type: 'tool-skill_read',
          state: 'output-available',
          input: { name: 'pptx' },
        },
        {
          type: 'tool-skill_read',
          state: 'output-error',
          input: { name: 'broken' },
        },
      ])
    ).toEqual(['pptx'])
  })
})

describe('subagentActivityLabel', () => {
  it('returns null when no subagent is running', () => {
    const subagents: SubagentRun[] = [
      {
        runId: 'r1',
        name: 'Researcher',
        status: 'done',
        startedAt: 1,
        turns: [],
      },
    ]
    expect(subagentActivityLabel(subagents)).toBeNull()
  })

  it('labels a single running subagent with its own tool activity', () => {
    const subagents: SubagentRun[] = [
      {
        runId: 'r1',
        name: 'Researcher',
        status: 'running',
        startedAt: 1000,
        turns: [
          {
            role: 'tool',
            content: '',
            name: 'write',
            args: { path: 'notes.md' },
            status: 'running',
          },
        ],
      },
    ]
    expect(subagentActivityLabel(subagents)).toEqual({
      text: 'Researcher: Writing notes.md',
      startedAt: 1000,
    })
  })

  it('labels a single running subagent with "working" when it has no tool turn', () => {
    const subagents: SubagentRun[] = [
      {
        runId: 'r1',
        name: 'Researcher',
        status: 'running',
        startedAt: 1000,
        turns: [],
      },
    ]
    expect(subagentActivityLabel(subagents)).toEqual({
      text: 'Researcher: working',
      startedAt: 1000,
    })
  })

  it('labels multiple running subagents with a count and earliest startedAt', () => {
    const subagents: SubagentRun[] = [
      { runId: 'r1', name: 'A', status: 'running', startedAt: 2000, turns: [] },
      { runId: 'r2', name: 'B', status: 'running', startedAt: 1000, turns: [] },
      { runId: 'r3', name: 'C', status: 'done', startedAt: 500, turns: [] },
    ]
    expect(subagentActivityLabel(subagents)).toEqual({
      text: '2 subagents working',
      startedAt: 1000,
    })
  })
})

describe('awaitsModel', () => {
  const tool = (status: CoworkTurn['status']): CoworkTurn => ({
    role: 'tool',
    content: '',
    callId: 'c1',
    name: 'bash',
    status,
  })

  it('is false when nothing is running', () => {
    expect(awaitsModel(false, [])).toBe(false)
    expect(awaitsModel(false, [{ role: 'user', content: 'hi' }])).toBe(false)
  })

  it('is true before the first token', () => {
    expect(awaitsModel(true, [{ role: 'user', content: 'hi' }])).toBe(true)
    expect(awaitsModel(true, [])).toBe(true)
  })

  // The gap between a finished tool and the next token has nothing else on
  // screen reporting progress.
  it('is true again after a tool settles', () => {
    expect(awaitsModel(true, [tool('done')])).toBe(true)
  })

  it('is false while a tool is running or text is streaming', () => {
    expect(awaitsModel(true, [tool('running')])).toBe(false)
    expect(awaitsModel(true, [{ role: 'assistant', content: 'thinking' }])).toBe(
      false
    )
  })
})
