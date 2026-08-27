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

const SANDBOX = '/home/u/.jan/agent-workspace/sessions/4f2a'

describe('CoworkWorkspacePill', () => {
  beforeEach(() => {
    openPath.mockReset()
    revealItemInDir.mockReset()
  })

  it('names only the sandbox when no folder is attached', async () => {
    render(
      <CoworkWorkspacePill
        folder={null}
        sandboxPath={SANDBOX}
        onAttach={vi.fn()}
        onDetach={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText('common:workspace.writesTo')).toBeInTheDocument()
    expect(screen.queryByText('common:workspace.readsFrom')).toBeNull()
    // No folder means nothing to detach.
    expect(screen.queryByText('common:workspace.detach')).toBeNull()
    expect(screen.getByText('common:workspace.attach')).toBeInTheDocument()
  })

  // The honesty requirement: whenever a folder is attached, the popover must
  // state both directions and mark the folder read-only. A regression here
  // would have the UI implying the agent edits the user's project.
  it('states both directions and marks the folder read-only', async () => {
    render(
      <CoworkWorkspacePill
        folder="/home/u/Projects/jan-app"
        sandboxPath={SANDBOX}
        gitBranch="dev"
        onAttach={vi.fn()}
        onDetach={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /a11yWithFolder/ }))

    expect(screen.getByText('common:workspace.readsFrom')).toBeInTheDocument()
    expect(screen.getByText('common:workspace.writesTo')).toBeInTheDocument()
    expect(
      screen.getAllByText('common:workspace.readOnly').length
    ).toBeGreaterThan(0)
    expect(screen.getByText('dev')).toBeInTheDocument()
    expect(screen.getByText('common:workspace.footnote')).toBeInTheDocument()
  })

  it('opens the folder and reveals it through the right opener calls', async () => {
    render(
      <CoworkWorkspacePill
        folder="/home/u/Projects/jan-app"
        sandboxPath={SANDBOX}
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
        sandboxPath={SANDBOX}
        onAttach={vi.fn()}
        onDetach={onDetach}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /a11yWithFolder/ }))
    await userEvent.click(screen.getByText('common:workspace.detach'))
    expect(onDetach).toHaveBeenCalled()
  })
})
