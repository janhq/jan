import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('@/components/DiffView', () => ({
  DiffView: ({ diff }: { diff: string }) => <pre data-testid="diff">{diff}</pre>,
}))

import { CoworkDiffPanel } from '../CoworkDiffPanel'
import type { CoworkFileDiff } from '@/lib/coworkDiffs'

const files: CoworkFileDiff[] = [
  {
    path: 'report.md',
    additions: 5,
    deletions: 2,
    operations: [{ diff: '+ new line', source: 'main' }],
  },
  {
    path: 'chart.py',
    additions: 1,
    deletions: 0,
    operations: [
      { diff: '+ import numpy', source: 'subagent', sourceName: 'researcher' },
    ],
  },
]

describe('CoworkDiffPanel', () => {
  it('summarises the totals across files', () => {
    render(<CoworkDiffPanel files={files} onClose={vi.fn()} />)
    expect(screen.getByText('+6 -2')).toBeInTheDocument()
  })

  // Collapsed by default: a run touching a dozen files should open as a list,
  // not a wall of hunks.
  it('reveals a file’s hunks only once it is expanded', async () => {
    render(<CoworkDiffPanel files={files} onClose={vi.fn()} />)
    expect(screen.queryByTestId('diff')).toBeNull()

    await userEvent.click(screen.getByText('report.md'))
    expect(screen.getByTestId('diff')).toHaveTextContent('+ new line')
  })

  it('attributes a subagent’s edit to it', async () => {
    render(<CoworkDiffPanel files={files} onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('chart.py'))
    expect(screen.getByText('researcher')).toBeInTheDocument()
  })

  it('says what will appear here when nothing has changed', () => {
    render(<CoworkDiffPanel files={[]} onClose={vi.fn()} />)
    expect(screen.getByText('common:changes.empty')).toBeInTheDocument()
  })
})
