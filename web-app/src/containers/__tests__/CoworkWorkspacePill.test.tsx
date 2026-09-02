import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k} ${Object.values(opts).join(' ')}` : k,
  }),
}))

const openPath = vi.fn()
const revealItemInDir = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ opener: () => ({ openPath, revealItemInDir }) }),
}))

import { CoworkWorkspacePill } from '../CoworkWorkspacePill'

describe('CoworkWorkspacePill', () => {
  beforeEach(() => {
    openPath.mockReset()
    revealItemInDir.mockReset()
  })

  it('invites attaching a folder when none is attached', async () => {
    render(
      <CoworkWorkspacePill folder={null} onAttach={vi.fn()} onDetach={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: /a11yNoFolder/ }))

    expect(screen.queryByText('common:workspace.readsFrom')).toBeNull()
    // No folder means nothing to detach.
    expect(screen.queryByText('common:workspace.detach')).toBeNull()
    expect(
      screen.getAllByText('common:workspace.attach').length
    ).toBeGreaterThan(0)
  })

  // The honesty requirement, inverted from the read-only days: the folder is
  // mounted writable now, so the popover must say the agent edits it in place.
  // A regression here would have the UI promising an untouched project while
  // the agent changes real files.
  it('names the folder and marks it read & write', async () => {
    render(
      <CoworkWorkspacePill
        folder="/home/u/Projects/jan-app"
        gitBranch="dev"
        onAttach={vi.fn()}
        onDetach={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /a11yWithFolder/ }))

    expect(screen.getByText('common:workspace.readsFrom')).toBeInTheDocument()
    expect(
      screen.getAllByText('common:workspace.writable').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText('common:workspace.readOnly')).toBeNull()
    expect(screen.getByText('dev')).toBeInTheDocument()
    expect(screen.getByText('common:workspace.footnote')).toBeInTheDocument()
  })

  it('opens the folder and reveals it through the right opener calls', async () => {
    render(
      <CoworkWorkspacePill
        folder="/home/u/Projects/jan-app"
        onAttach={vi.fn()}
        onDetach={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /a11yWithFolder/ }))

    await userEvent.click(screen.getAllByText('common:workspace.open')[0])
    expect(openPath).toHaveBeenCalledWith('/home/u/Projects/jan-app')

    await userEvent.click(screen.getByText('common:workspace.reveal'))
    expect(revealItemInDir).toHaveBeenCalledWith('/home/u/Projects/jan-app')
  })

  it('detaches the folder', async () => {
    const onDetach = vi.fn()
    render(
      <CoworkWorkspacePill
        folder="/home/u/Projects/jan-app"
        onAttach={vi.fn()}
        onDetach={onDetach}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /a11yWithFolder/ }))
    await userEvent.click(screen.getByText('common:workspace.detach'))
    expect(onDetach).toHaveBeenCalled()
  })
})
