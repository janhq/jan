import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { staged } from '@/services/extensions/__tests__/mock'
import { ConsentDialog } from '../ConsentDialog'
import { PermissionDiffDialog } from '../PermissionDiffDialog'

vi.mock('@/i18n/react-i18next-compat', async () => {
  const i18n = (await import('@/i18n/setup')).default
  return { useTranslation: () => ({ t: i18n.t, i18n }) }
})

describe('ConsentDialog', () => {
  it('keeps Install disabled for an unverified bundle until the author is trusted', async () => {
    const onConfirm = vi.fn()
    render(
      <ConsentDialog
        staged={staged('acme.hello', ['ui:notify', 'tools'])}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Install Ext acme.hello?')
    expect(within(dialog).getByText('Unverified')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('sha512-c3RhZ2Vk')
    expect(dialog).toHaveTextContent('Show notifications')
    expect(dialog).toHaveTextContent('Add tools for models')

    const install = within(dialog).getByRole('button', { name: 'Install' })
    expect(install).toBeDisabled()
    await userEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'I trust the author of this file',
      })
    )
    expect(install).toBeEnabled()
    await userEvent.click(install)
    expect(onConfirm).toHaveBeenCalledWith(['ui:notify', 'tools'])
  })

  it('names the source that verified an index install and needs no trust checkbox', async () => {
    const onConfirm = vi.fn()
    render(
      <ConsentDialog
        staged={staged('acme.hello', ['network:api.acme.dev'], {
          verified: true,
          integrityChecked: true,
        })}
        sourceName="Acme Index"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Verified by Acme Index')
    expect(dialog).toHaveTextContent('Integrity checked')
    expect(within(dialog).queryByText('Unverified')).toBeNull()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    expect(onConfirm).toHaveBeenCalledWith(['network:api.acme.dev'])
  })

  it('requires trusting an install from an unsigned source', async () => {
    const onConfirm = vi.fn()
    render(
      <ConsentDialog
        staged={staged('acme.hello', ['ui:notify'], {
          verified: false,
          integrityChecked: true,
        })}
        sourceName="Open Index"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('From Open Index')
    expect(within(dialog).getByText('Unsigned source')).toBeInTheDocument()
    expect(within(dialog).queryByText('Unverified')).toBeNull()
    const install = within(dialog).getByRole('button', { name: 'Install' })
    expect(install).toBeDisabled()
    await userEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'I trust the author and this index',
      })
    )
    await userEvent.click(install)
    expect(onConfirm).toHaveBeenCalledWith(['ui:notify'])
  })

  it('cancels without confirming', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConsentDialog
        staged={staged('acme.hello', [])}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'It requests no permissions.'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('PermissionDiffDialog', () => {
  const update = staged('acme.hello', ['ui:notify', 'tools', 'providers'], {
    existing: { version: '0.9.0', granted: ['ui:notify', 'conversations:read'] },
    permissionDiff: {
      added: ['tools', 'providers'],
      removed: ['conversations:read'],
    },
  })

  it('asks only for the added permissions and lists removed ones as information', async () => {
    const onConfirm = vi.fn()
    render(
      <PermissionDiffDialog
        staged={update}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Update Ext acme.hello to 1.0.0?')
    const added = within(dialog).getByRole('list', {
      name: 'New permissions',
    })
    expect(added).toHaveTextContent('Add tools for models')
    expect(added).toHaveTextContent('Add model providers')
    // Already granted: not asked again.
    expect(dialog).not.toHaveTextContent('Show notifications')
    const removed = within(dialog).getByRole('list', {
      name: 'No longer needed',
    })
    expect(removed).toHaveTextContent('Read your conversations')

    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update' }))
    // confirm_install needs every requested permission, not just the new ones.
    expect(onConfirm).toHaveBeenCalledWith(['ui:notify', 'tools', 'providers'])
  })

  it('cancel calls onCancel', async () => {
    const onCancel = vi.fn()
    render(
      <PermissionDiffDialog
        staged={update}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('says when an update asks for nothing new', () => {
    render(
      <PermissionDiffDialog
        staged={{ ...update, permissionDiff: { added: [], removed: [] } }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This update asks for no new permissions.'
    )
  })

  it('still requires trusting the author of an unverified update', async () => {
    render(
      <PermissionDiffDialog
        staged={update}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const button = screen.getByRole('button', { name: 'Update' })
    expect(button).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(button).toBeEnabled()
  })
})
