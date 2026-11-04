import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k} ${Object.values(opts).join(' ')}` : k,
  }),
}))

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { error: toastError },
}))

const openPath = vi.fn()
const revealItemInDir = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ opener: () => ({ openPath, revealItemInDir }) }),
}))

import { CoworkWorkspacePill } from '../CoworkWorkspacePill'

describe('CoworkWorkspacePill', () => {
  beforeEach(() => {
    openPath.mockReset().mockResolvedValue(undefined)
    revealItemInDir.mockReset().mockResolvedValue(undefined)
    toastError.mockReset()
  })

  it('invites attaching a folder when none is attached', async () => {
    render(
      <CoworkWorkspacePill folder={null} onAttach={vi.fn()} onDetach={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: /a11yNoFolder/ }))

    // No folder means nothing to detach.
    expect(screen.queryByText('common:workspace.detach')).toBeNull()
    expect(
      screen.getAllByText('common:workspace.attach').length
    ).toBeGreaterThan(0)
  })

  const PATH = '/home/u/Projects/jan-app'
  const renderPill = (props: Partial<React.ComponentProps<typeof CoworkWorkspacePill>> = {}) =>
    render(
      <CoworkWorkspacePill
        folder={PATH}
        onAttach={vi.fn()}
        onDetach={vi.fn()}
        {...props}
      />
    )
  const openPopover = (name = /a11yWithFolder/) =>
    userEvent.click(screen.getByRole('button', { name }))
  const accessButton = () =>
    screen.getByRole('button', { name: /common:workspace\.changeAccess/ })

  it('names the folder, marks it read & write and drops the old chrome', async () => {
    renderPill({ gitBranch: 'dev' })
    const trigger = screen.getByRole('button', { name: /a11yWithFolder/ })
    expect(trigger).toHaveClass('h-9', 'rounded-full', 'border-border', 'text-muted-foreground')
    expect(trigger.querySelector('svg')).toHaveClass('size-4', 'shrink-0')
    await userEvent.click(trigger)

    expect(accessButton()).toHaveTextContent('common:workspace.writable')
    expect(screen.queryByText('common:workspace.readOnly')).toBeNull()
    expect(screen.getByText('dev')).toBeInTheDocument()
    for (const gone of ['readsFrom', 'open', 'reveal', 'footnote', 'footnoteReadOnly', 'allowChanges']) {
      expect(screen.queryByText(`common:workspace.${gone}`)).toBeNull()
    }
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common:workspace.open' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'common:workspace.reveal' })).toBeNull()
  })

  it('shows read only when the grant is read', async () => {
    renderPill({ access: 'read', onAccessChange: vi.fn() })
    await openPopover(/a11yWithFolderReadOnly/)
    expect(accessButton()).toHaveTextContent('common:workspace.readOnly')
  })

  it('reveals the folder from the folder name', async () => {
    renderPill()
    await openPopover()
    await userEvent.click(
      screen.getByRole('button', { name: `common:workspace.revealFolder ${'jan-app'}` })
    )
    expect(revealItemInDir).toHaveBeenCalledWith(PATH)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reveals the folder from the file path', async () => {
    renderPill()
    await openPopover()
    await userEvent.click(
      screen.getByRole('button', { name: `common:workspace.revealFolder ${PATH}` })
    )
    expect(revealItemInDir).toHaveBeenCalledWith(PATH)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reveals from the keyboard', async () => {
    renderPill()
    await openPopover()
    const name = screen.getByRole('button', { name: 'common:workspace.revealFolder jan-app' })
    name.focus()
    await userEvent.keyboard('{Enter}')
    expect(revealItemInDir).toHaveBeenCalledWith(PATH)
  })

  it.each(['name', 'path'])('notifies and offers a replacement when the folder cannot be revealed from the %s', async (which) => {
    revealItemInDir.mockRejectedValueOnce(new Error('path does not exist'))
    const onAttach = vi.fn()
    renderPill({ onAttach })
    await openPopover()
    await userEvent.click(
      screen.getByRole('button', {
        name: `common:workspace.revealFolder ${which === 'name' ? 'jan-app' : PATH}`,
      })
    )

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'common:workspace.unavailable',
        expect.objectContaining({
          description: 'common:workspace.missing jan-app',
          action: expect.objectContaining({
            label: 'common:workspace.change',
            onClick: onAttach,
          }),
        })
      )
    })
    const [, options] = toastError.mock.calls[0]
    options.action.onClick()
    expect(onAttach).toHaveBeenCalledOnce()
  })

  it('reports other reveal failures with the host detail', async () => {
    revealItemInDir.mockRejectedValueOnce(new Error('denied'))
    renderPill()
    await openPopover()
    await userEvent.click(screen.getByRole('button', { name: 'common:workspace.revealFolder jan-app' }))
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'common:workspace.revealFailed',
        expect.objectContaining({ description: 'denied' })
      )
    )
  })

  it('detaches the folder', async () => {
    const onDetach = vi.fn()
    renderPill({ onDetach })
    await openPopover()
    await userEvent.click(screen.getByRole('button', { name: 'common:workspace.detach' }))
    expect(onDetach).toHaveBeenCalledOnce()
  })

  it('changes the folder', async () => {
    const onAttach = vi.fn()
    renderPill({ onAttach })
    await openPopover()
    await userEvent.click(screen.getByRole('button', { name: 'common:workspace.change' }))
    expect(onAttach).toHaveBeenCalledOnce()
  })

  it('toggles read only to read & write by clicking the access badge', async () => {
    const onAccessChange = vi.fn()
    renderPill({ access: 'read', onAccessChange })
    await openPopover(/a11yWithFolderReadOnly/)
    expect(accessButton()).toHaveAccessibleName(
      'common:workspace.changeAccess common:workspace.readOnly common:workspace.writable'
    )
    await userEvent.click(accessButton())
    expect(onAccessChange).toHaveBeenCalledOnce()
    expect(onAccessChange).toHaveBeenCalledWith('write')
  })

  it('toggles read & write to read only by clicking the access badge', async () => {
    const onAccessChange = vi.fn()
    renderPill({ access: 'write', onAccessChange })
    await openPopover()
    expect(accessButton()).toHaveAccessibleName(
      'common:workspace.changeAccess common:workspace.writable common:workspace.readOnly'
    )
    await userEvent.click(accessButton())
    expect(onAccessChange).toHaveBeenCalledWith('read')
  })

  it('toggles access from the keyboard', async () => {
    const onAccessChange = vi.fn()
    renderPill({ access: 'read', onAccessChange })
    await openPopover(/a11yWithFolderReadOnly/)
    accessButton().focus()
    await userEvent.keyboard(' ')
    expect(onAccessChange).toHaveBeenCalledWith('write')
  })

  it('disables the access badge without a callback', async () => {
    renderPill({ access: 'read' })
    await openPopover(/a11yWithFolderReadOnly/)
    expect(accessButton()).toBeDisabled()
  })

  it('disables every folder action while saving', async () => {
    const onAccessChange = vi.fn()
    const onDetach = vi.fn()
    renderPill({ access: 'write', saving: true, onAccessChange, onDetach })
    await openPopover()
    expect(accessButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common:workspace.revealFolder jan-app' })).toBeDisabled()
    expect(screen.getByRole('button', { name: `common:workspace.revealFolder ${PATH}` })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common:workspace.change' })).toBeDisabled()
    const detach = screen.getByRole('button', { name: 'common:workspace.detach' })
    expect(detach).toBeDisabled()
    await userEvent.click(accessButton())
    await userEvent.click(detach)
    expect(onAccessChange).not.toHaveBeenCalled()
    expect(onDetach).not.toHaveBeenCalled()
    expect(revealItemInDir).not.toHaveBeenCalled()
  })

  describe('inactive folder (access null)', () => {
    it('shows an explicit confirm action and never grants by toggling', async () => {
      const onAccessChange = vi.fn()
      const onAllowAccess = vi.fn()
      renderPill({ access: null, onAccessChange, onAllowAccess })
      await userEvent.click(screen.getByRole('button', { name: 'jan-app' }))

      expect(screen.getByText('common:conversationScope.folderNeedsConfirmation')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /common:workspace\.changeAccess/ })).toBeNull()
      expect(screen.queryByText('common:workspace.writable')).toBeNull()
      expect(screen.queryByText('common:workspace.readOnly')).toBeNull()
      expect(onAllowAccess).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: 'common:conversationScope.confirmFolder' }))
      expect(onAllowAccess).toHaveBeenCalledOnce()
      expect(onAccessChange).not.toHaveBeenCalled()
    })

    it('offers no confirm action without a callback and disables it while saving', async () => {
      const { rerender } = render(
        <CoworkWorkspacePill folder={PATH} access={null} onAttach={vi.fn()} onDetach={vi.fn()} />
      )
      await userEvent.click(screen.getByRole('button', { name: 'jan-app' }))
      expect(screen.queryByRole('button', { name: 'common:conversationScope.confirmFolder' })).toBeNull()

      rerender(
        <CoworkWorkspacePill folder={PATH} access={null} saving onAllowAccess={vi.fn()} onAttach={vi.fn()} onDetach={vi.fn()} />
      )
      expect(screen.getByRole('button', { name: 'common:conversationScope.confirmFolder' })).toBeDisabled()
    })
  })
})
