import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { staged } from '@/services/extensions/__tests__/mock'
import type { StagedInstall } from '@/services/extensions/types'
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

  it('says network:* includes every loopback host except the local API server', () => {
    render(
      <ConsentDialog
        staged={staged('acme.hello', ['network:*'])}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      "Includes servers on this computer on any port: localhost and 127.0.0.1 over http or https, other local addresses such as ::1 over https only. Jan's own local API server is always blocked."
    )
  })

  it('says a local host grant covers any port except the local API server', () => {
    render(
      <ConsentDialog
        staged={staged('acme.hello', ['network:localhost'])}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(
      "Covers every port of this host, over http or https, except Jan's own local API server, which is always blocked."
    )
    expect(dialog).not.toHaveTextContent('::1')
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

describe('ConsentDialog l10n', () => {
  afterEach(() => useGeneralSetting.setState({ currentLanguage: 'en' }))

  it('names the extension in the app language', () => {
    useGeneralSetting.setState({ currentLanguage: 'ja' })
    const pending = staged('acme.hello', [])
    pending.manifest = {
      ...pending.manifest,
      displayName: '%name%',
      l10n: { en: { name: 'Hello' }, ja: { name: 'Konnichiwa' } },
    }
    render(
      <ConsentDialog staged={pending} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByRole('dialog')).toHaveTextContent('Install Konnichiwa?')
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

  const indexSource = (sourceId: string, sourceName: string) => ({
    kind: 'index' as const,
    sourceId,
    sourceName,
    url: `https://${sourceId}.dev/index.json`,
    tarball: `https://${sourceId}.dev/hello.tgz`,
    integrity: 'sha512-c3RhZ2Vk',
  })
  const fromSource = (
    next: StagedInstall['source'],
    previous: StagedInstall['source'],
    flags: { verified?: boolean; wasVerified?: boolean } = {}
  ): StagedInstall => ({
    ...update,
    verified: flags.verified ?? false,
    integrityChecked: next.kind === 'index',
    source: next,
    existing: {
      ...update.existing!,
      installedFrom: { source: previous, verified: flags.wasVerified ?? false },
    },
  })
  const renderUpdate = (s: StagedInstall) =>
    render(
      <PermissionDiffDialog staged={s} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )

  it('warns when an update comes from another index than the installed version', () => {
    renderUpdate(
      fromSource(indexSource('b', 'Other Index'), indexSource('a', 'Acme Index'), {
        verified: true,
        wasVerified: true,
      })
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Verified by Other Index')
    expect(dialog).toHaveTextContent(
      'This update comes from Other Index, but Ext acme.hello was installed from Acme Index.'
    )
  })

  it('warns when a file replaces a version installed from an index', () => {
    renderUpdate(
      fromSource(
        { kind: 'bundle', fileName: 'hello.tgz', sha512: 'sha512-c3RhZ2Vk' },
        indexSource('a', 'Acme Index'),
        { wasVerified: true }
      )
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This update is a file from disk, but Ext acme.hello was installed from Acme Index.'
    )
  })

  it('warns when an index update replaces a version installed from a file', () => {
    renderUpdate(
      fromSource(indexSource('a', 'Acme Index'), {
        kind: 'bundle',
        fileName: 'old.tgz',
        sha512: 'sha512-old',
      })
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This update comes from Acme Index, but Ext acme.hello was installed from the file old.tgz.'
    )
  })

  it('warns when an update of a signed install is not signed', () => {
    const acme = indexSource('a', 'Acme Index')
    renderUpdate(fromSource(acme, acme, { verified: false, wasVerified: true }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(
      'Ext acme.hello was verified by the signing key of Acme Index, but this update is not signed.'
    )
    expect(dialog).not.toHaveTextContent('This update comes from')
  })

  it('does not warn for an update from the same source', () => {
    const acme = indexSource('a', 'Acme Index')
    renderUpdate(
      fromSource(acme, { ...acme, sourceId: 're-added' }, {
        verified: true,
        wasVerified: true,
      })
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveTextContent('This update')
    expect(dialog).not.toHaveTextContent('not signed')
  })

  it('does not warn for a file replacing a file', () => {
    renderUpdate(
      fromSource(
        { kind: 'bundle', fileName: 'hello.tgz', sha512: 'sha512-c3RhZ2Vk' },
        { kind: 'bundle', fileName: 'hello-old.tgz', sha512: 'sha512-old' }
      )
    )
    expect(screen.getByRole('dialog')).not.toHaveTextContent('This update is')
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
