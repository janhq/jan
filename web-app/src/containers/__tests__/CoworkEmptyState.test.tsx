import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts?.folder ? `${k}[${opts.folder}]` : k,
  }),
}))

import { CoworkEmptyState } from '../CoworkEmptyState'

describe('CoworkEmptyState', () => {
  it('offers workspace examples when no folder is attached', () => {
    render(<CoworkEmptyState folder={null} onPick={vi.fn()} />)

    expect(
      screen.getByText('common:coworkEmpty.subtitleSandbox')
    ).toBeInTheDocument()
    expect(
      screen.getByText('common:coworkEmpty.sandbox.first')
    ).toBeInTheDocument()
    expect(screen.queryByText(/coworkEmpty\.folder\./)).toBeNull()
  })

  // The reason the examples exist: a fixed list is wallpaper, one naming the
  // folder you just attached is a task you might actually run.
  it('names the attached folder in every example', () => {
    render(
      <CoworkEmptyState folder="/home/u/Projects/jan-app" onPick={vi.fn()} />
    )

    expect(
      screen.getByText('common:coworkEmpty.subtitleFolder[jan-app]')
    ).toBeInTheDocument()
    for (const key of ['first', 'second', 'third']) {
      expect(
        screen.getByText(`common:coworkEmpty.folder.${key}[jan-app]`)
      ).toBeInTheDocument()
    }
  })

  // Loaded, not sent: an example is a starting point the user edits.
  it('loads a picked example rather than submitting it', async () => {
    const onPick = vi.fn()
    render(<CoworkEmptyState folder={null} onPick={onPick} />)

    await userEvent.click(screen.getByText('common:coworkEmpty.sandbox.second'))
    expect(onPick).toHaveBeenCalledWith('common:coworkEmpty.sandbox.second')
  })
})
