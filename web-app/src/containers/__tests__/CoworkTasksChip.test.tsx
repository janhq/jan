import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k} ${Object.values(opts).join(' ')}` : k,
  }),
}))

import { CoworkTasksChip } from '../CoworkTasksChip'
import type { SubagentRun } from '@/types/coworkSession'

const run = (runId: string, status: SubagentRun['status']): SubagentRun => ({
  runId,
  name: 'researcher',
  status,
  startedAt: 0,
  turns: [],
})

describe('CoworkTasksChip', () => {
  // Nothing dispatched is nothing to say, so the dock row stays quiet.
  it('renders nothing before a subagent is dispatched', () => {
    const { container } = render(
      <CoworkTasksChip subagents={[]} open={false} onToggle={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  /// The count that used to sit in the transcript. It belongs here: a child
  /// outlives the turn that dispatched it, so a row in the scrollback went
  /// stale under a conversation that had moved on.
  it('counts the running children against the total', () => {
    render(
      <CoworkTasksChip
        subagents={[run('a', 'running'), run('b', 'running'), run('c', 'done')]}
        open={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(
      screen.getByLabelText('common:subagentsRunning 2')
    ).toBeInTheDocument()
  })

  it('reports the total once they have all finished', () => {
    render(
      <CoworkTasksChip
        subagents={[run('a', 'done'), run('b', 'done')]}
        open={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByLabelText('common:backgroundTasks')).toBeInTheDocument()
  })
})
