import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k} ${Object.values(opts).join(' ')}` : k,
  }),
}))

import { CoworkBudgetNotice } from '../CoworkBudgetNotice'

describe('CoworkBudgetNotice', () => {
  it('offers Keep going when the step cap is hit', async () => {
    const onContinue = vi.fn()
    render(
      <CoworkBudgetNotice kind="steps" max={100} onContinue={onContinue} />
    )
    expect(
      screen.getByText('common:budget.stoppedSteps 100')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByText('common:budget.keepGoing'))
    expect(onContinue).toHaveBeenCalled()
  })

  it('offers Compact and New session when the token budget is hit', async () => {
    const onCompact = vi.fn()
    const onNewSession = vi.fn()
    render(
      <CoworkBudgetNotice
        kind="tokens"
        onCompact={onCompact}
        onNewSession={onNewSession}
      />
    )
    await userEvent.click(screen.getByText('common:budget.compact'))
    expect(onCompact).toHaveBeenCalled()
    await userEvent.click(screen.getByText('common:budget.newSession'))
    expect(onNewSession).toHaveBeenCalled()
  })

  // Routine, not a failure: a destructive/red treatment would teach users to
  // ignore the notices that do matter.
  it('is a status, not an alert', () => {
    render(<CoworkBudgetNotice kind="steps" max={30} onContinue={vi.fn()} />)
    const el = screen.getByTestId('cowork-budget-notice')
    expect(el).toHaveAttribute('role', 'status')
    expect(el.className).not.toMatch(/destructive|text-red/)
  })
})
