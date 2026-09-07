import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k} ${Object.values(opts).join(' ')}` : k,
  }),
}))

import { CoworkChangesChip } from '../CoworkChangesChip'
import type { CoworkFileDiff } from '@/lib/coworkDiffs'

const file = (
  path: string,
  additions: number,
  deletions: number
): CoworkFileDiff => ({ path, additions, deletions, operations: [] })

describe('CoworkChangesChip', () => {
  // Same rule as the plan and folder controls: nothing written yet is nothing
  // to say, so the dock row stays quiet.
  it('renders nothing before the agent has written anything', () => {
    const { container } = render(
      <CoworkChangesChip files={[]} open={false} onToggle={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('totals the counts across every changed file', () => {
    render(
      <CoworkChangesChip
        files={[file('a.ts', 3, 1), file('b.ts', 4, 6)]}
        open={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('+7')).toBeInTheDocument()
    expect(screen.getByText('-7')).toBeInTheDocument()
  })

  it('reports its state and toggles the rail', async () => {
    const onToggle = vi.fn()
    render(
      <CoworkChangesChip
        files={[file('a.ts', 1, 0)]}
        open={true}
        onToggle={onToggle}
      />
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
