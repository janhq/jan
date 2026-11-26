import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { CoworkRunNotice } from '../CoworkRunNotice'

describe('CoworkRunNotice', () => {
  // A stop is something the user just did: no colour, no alert role, and
  // nothing to act on.
  it('states a stop quietly, with no action', () => {
    render(<CoworkRunNotice kind="stopped" />)
    expect(screen.getByRole('status')).toHaveTextContent('common:run.stopped')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the provider’s own message rather than a generic one', () => {
    render(
      <CoworkRunNotice
        kind="error"
        message="error sending request for url"
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'error sending request for url'
    )
  })

  it('falls back to its own wording when the failure has none', () => {
    render(<CoworkRunNotice kind="error" message="   " onRetry={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('common:run.failed')
  })

  it('offers an increase-context action on overflow instead of a bare retry', async () => {
    const onIncreaseContext = vi.fn()
    render(
      <CoworkRunNotice
        kind="error"
        message="request (4423 tokens) exceeds the available context size (4096 tokens), try increasing it"
        onRetry={vi.fn()}
        onIncreaseContext={onIncreaseContext}
      />
    )
    const button = screen.getByRole('button', {
      name: 'model-errors:increaseContextSize',
    })
    await userEvent.click(button)
    expect(onIncreaseContext).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: 'common:run.tryAgain' })
    ).toBeNull()
  })
})
