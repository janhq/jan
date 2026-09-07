import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { CoworkPlanToggle } from '../CoworkPlanToggle'

describe('CoworkPlanToggle', () => {
  // aria-pressed, not aria-checked: this is a mode button, not a checkbox. The
  // visual cues are intentionally subtle, so the accessible state is the only
  // unambiguous signal.
  it('exposes its state through aria-pressed', () => {
    const { rerender } = render(
      <CoworkPlanToggle planMode={false} onChange={vi.fn()} />
    )
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')

    rerender(<CoworkPlanToggle planMode onChange={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles both ways', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <CoworkPlanToggle planMode={false} onChange={onChange} />
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith(true)

    onChange.mockReset()
    rerender(<CoworkPlanToggle planMode onChange={onChange} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('announces only while plan mode is on', () => {
    const { rerender } = render(
      <CoworkPlanToggle planMode={false} onChange={vi.fn()} />
    )
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('')
    rerender(<CoworkPlanToggle planMode onChange={vi.fn()} />)
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'common:planMode.onAnnounce'
    )
  })
})
