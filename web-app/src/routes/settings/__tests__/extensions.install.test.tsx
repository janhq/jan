// Settings > Extensions: install from file and from an index, the update
// permission diff, enable, safe mode and sources, against a mocked
// ExtensionsService. Strings are the real English ones.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType, ReactNode } from 'react'
import type { HostedExtension } from '@/lib/extensions/host'
import { manifest } from '@/lib/extensions/__tests__/fixtures'
import {
  createMockExtensionsService,
  installed,
  staged,
} from '@/services/extensions/__tests__/mock'

const h = vi.hoisted(() => ({
  hosted: [] as HostedExtension[],
  open: vi.fn(),
  reload: vi.fn(async (_id: string) => undefined),
  unload: vi.fn(async (_id: string) => undefined),
  loadInstalled: vi.fn(async () => undefined),
  service: undefined as unknown,
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: h.toastError, success: vi.fn() },
}))

vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({
    list: () => h.hosted,
    onDidChange: () => ({ dispose: () => undefined }),
    unload: h.unload,
    reload: h.reload,
    loadInstalled: h.loadInstalled,
  }),
}))
vi.mock('@/lib/extensions/installed-reload', () => ({
  reloadInstalled: h.reload,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: h.open }),
    extensions: () => h.service,
  }),
}))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/extensions/ExtensionSettingsForm', () => ({
  ExtensionSettingsForm: ({ extensionId }: { extensionId: string }) => (
    <div data-testid={`settings-form-${extensionId}`} />
  ),
}))
vi.mock('@/i18n/react-i18next-compat', async () => {
  const i18n = (await import('@/i18n/setup')).default
  return { useTranslation: () => ({ t: i18n.t, i18n }) }
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: ComponentType }) => config,
  Link: ({ children, params }: { children: ReactNode; params?: object }) => (
    <a href={JSON.stringify(params)}>{children}</a>
  ),
}))

import { Route } from '../extensions/index'

const Page = Route.component as ComponentType
let mock: ReturnType<typeof createMockExtensionsService>

beforeEach(() => {
  h.hosted = []
  h.open.mockReset()
  h.reload.mockClear()
  h.loadInstalled.mockClear()
  h.toastError.mockClear()
  mock = createMockExtensionsService()
  h.service = mock.service
})

describe('sections', () => {
  it('groups built-in, installed and development extensions', async () => {
    h.hosted = [
      {
        id: 'jan.core',
        manifest: manifest('jan.core', { displayName: 'Core Thing' }),
        source: 'builtin',
        state: 'active',
      },
      {
        id: 'acme.dev',
        manifest: manifest('acme.dev', { displayName: 'Dev Thing' }),
        source: 'dev',
        state: 'active',
      },
    ]
    mock.state.extensions = [installed('acme.hello')]
    render(<Page />)
    const builtin = screen.getByRole('region', { name: 'Built-in' })
    expect(builtin).toHaveTextContent('Core Thing')
    // Built-ins can be neither disabled nor uninstalled.
    expect(within(builtin).queryByRole('switch')).toBeNull()
    const mine = await screen.findByRole('region', { name: 'Installed' })
    expect(await within(mine).findByText('Ext acme.hello')).toBeInTheDocument()
    expect(within(mine).getByText('Unverified')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Loaded for development' })).toHaveTextContent(
      'Dev Thing'
    )
  })

  it('enables and disables an installed extension, then reloads it', async () => {
    mock.state.extensions = [installed('acme.hello')]
    render(<Page />)
    const toggle = await screen.findByRole('switch', {
      name: 'Enable Ext acme.hello',
    })
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    expect(mock.service.setEnabled).toHaveBeenCalledWith('acme.hello', false)
    await waitFor(() => expect(h.reload).toHaveBeenCalledWith('acme.hello'))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })
})

describe('failed installed extensions', () => {
  it('lists one whose manifest the host refused, with the reason', async () => {
    h.hosted = [
      {
        id: 'acme.broken',
        manifest: manifest('acme.broken', { displayName: 'acme.broken' }),
        source: 'installed',
        state: 'failed',
        error: 'jan.apiVersion: must be a caret range',
      },
    ]
    render(<Page />)
    const mine = await screen.findByRole('region', { name: 'Installed' })
    expect(
      await within(mine).findByText(
        'Failed to start: jan.apiVersion: must be a caret range'
      )
    ).toBeInTheDocument()
    expect(within(mine).queryByText('No extensions installed yet.')).toBeNull()
  })
})

describe('install from file', () => {
  it('opens a .tgz picker, gates on trust, and confirms exactly the requested grants', async () => {
    h.open.mockResolvedValue('/downloads/hello.tgz')
    mock.state.stage = staged('acme.hello', ['ui:notify', 'network:api.acme.dev'])
    render(<Page />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Install from file...' })
    )
    expect(h.open).toHaveBeenCalledWith({
      filters: [{ name: 'Extension bundle', extensions: ['tgz'] }],
    })
    expect(mock.service.stageBundle).toHaveBeenCalledWith('/downloads/hello.tgz')

    const dialog = await screen.findByRole('dialog')
    const install = within(dialog).getByRole('button', { name: 'Install' })
    expect(install).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(install)

    expect(mock.service.confirmInstall).toHaveBeenCalledWith(
      'stage-acme.hello',
      ['ui:notify', 'network:api.acme.dev']
    )
    await waitFor(() => expect(h.reload).toHaveBeenCalledWith('acme.hello'))
    expect(await screen.findByText('Ext acme.hello')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reloads and re-reads the list when the install fails after Rust took it', async () => {
    h.open.mockResolvedValue('/downloads/hello.tgz')
    mock.state.stage = staged('acme.hello', ['ui:notify'])
    mock.service.confirmInstall.mockRejectedValueOnce(
      new Error("Installed extension 'acme.hello' has an invalid manifest")
    )
    render(<Page />)
    await waitFor(() => expect(mock.service.list).toHaveBeenCalledTimes(1))
    await userEvent.click(
      screen.getByRole('button', { name: 'Install from file...' })
    )
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(h.reload).toHaveBeenCalledWith('acme.hello'))
    await waitFor(() => expect(mock.service.list).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('discards the stage when consent is cancelled', async () => {
    h.open.mockResolvedValue('/downloads/hello.tgz')
    mock.state.stage = staged('acme.hello', ['ui:notify'])
    render(<Page />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Install from file...' })
    )
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mock.service.discardStage).toHaveBeenCalledWith('stage-acme.hello')
    expect(mock.service.confirmInstall).not.toHaveBeenCalled()
  })

  it('does nothing when the picker is cancelled', async () => {
    h.open.mockResolvedValue(null)
    render(<Page />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Install from file...' })
    )
    expect(mock.service.stageBundle).not.toHaveBeenCalled()
  })

  it('shows the update diff for an installed id, and cancel discards the stage', async () => {
    mock.state.extensions = [
      installed('acme.hello', { granted: ['ui:notify'] }),
    ]
    mock.state.stage = staged('acme.hello', ['ui:notify', 'tools'], {
      existing: { version: '1.0.0', granted: ['ui:notify'] },
      permissionDiff: { added: ['tools'], removed: [] },
    })
    h.open.mockResolvedValue('/downloads/hello-2.tgz')
    render(<Page />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Install from file...' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Update Ext acme.hello')
    const added = within(dialog).getByRole('list', { name: 'New permissions' })
    expect(added).toHaveTextContent('Add tools for models')
    expect(dialog).not.toHaveTextContent('Show notifications')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mock.service.discardStage).toHaveBeenCalledWith('stage-acme.hello')
  })

  it('shows a translated error toast when staging fails', async () => {
    h.open.mockResolvedValue('/downloads/bad.tgz')
    render(<Page />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Install from file...' })
    )
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        'Could not open the extension: nothing to stage'
      )
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('safe mode', () => {
  it('shows a banner that turns safe mode off', async () => {
    mock.state.safeMode = true
    render(<Page />)
    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(
      'Safe mode is on. Installed extensions are not loaded.'
    )
    await userEvent.click(
      within(banner).getByRole('button', { name: 'Turn off safe mode' })
    )
    expect(mock.service.setSafeMode).toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    // Loaded now, not at the next start.
    expect(h.loadInstalled).toHaveBeenCalled()
  })

  it('turns safe mode on from its switch', async () => {
    render(<Page />)
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Safe mode' })
    )
    expect(mock.service.setSafeMode).toHaveBeenCalledWith(true)
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('stops the running installed extensions when it turns on', async () => {
    mock.state.extensions = [installed('acme.hello')]
    render(<Page />)
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Safe mode' })
    )
    await waitFor(() => expect(h.reload).toHaveBeenCalledWith('acme.hello'))
  })
})

describe('catalog', () => {
  const index = {
    schema: 1 as const,
    generatedAt: '2026-10-23T00:00:00Z',
    extensions: [
      {
        id: 'acme.hello',
        displayName: 'Hello',
        publisher: 'Acme',
        description: 'Says hello',
        versions: [
          {
            version: '0.1.0',
            tarball: 'https://a.b/0.1.0.tgz',
            integrity: 'sha512-a',
            apiVersion: '^1.0.0',
            permissions: [],
          },
          {
            version: '0.2.0',
            tarball: 'https://a.b/0.2.0.tgz',
            integrity: 'sha512-b',
            apiVersion: '^1.0.0',
            permissions: [],
            provenance: 'https://search.sigstore.dev/?hash=b',
          },
        ],
      },
    ],
  }
  const KEY = 'A'.repeat(42) + 'E='
  const NEXT = 'B'.repeat(42) + 'E='
  const catalog = { index, signed: true, nextPublicKey: null }
  const source = {
    id: 'src-1',
    name: 'Acme Index',
    url: 'https://acme.dev/index.json',
    publicKey: KEY,
    addedAt: '2026-10-23T10:00:00Z',
  }
  const indexStage = (signed: boolean) =>
    staged('acme.hello', ['ui:notify'], {
      verified: signed,
      integrityChecked: true,
      source: {
        kind: 'index',
        sourceId: 'src-1',
        sourceName: 'Acme Index',
        url: source.url,
        tarball: 'https://a.b/0.2.0.tgz',
        integrity: 'sha512-b',
      },
    })

  it('adds an https source and refuses an http one', async () => {
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    const url = await screen.findByLabelText('Index URL')
    await userEvent.type(url, 'http://acme.dev/index.json')
    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    expect(screen.getByText('Only https URLs are allowed.')).toBeInTheDocument()
    expect(mock.service.addSource).not.toHaveBeenCalled()

    await userEvent.clear(url)
    await userEvent.type(url, 'https://acme.dev/index.json')
    const key = 'A'.repeat(43) + '='
    await userEvent.type(screen.getByLabelText('Public key (optional)'), key)
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    expect(mock.service.addSource).toHaveBeenCalledWith(
      'https://acme.dev/index.json',
      'Acme',
      key
    )
    expect(await screen.findByText('Signing key pinned')).toBeInTheDocument()
  })

  it('removes an unsigned source without asking', async () => {
    const open = { ...source, publicKey: undefined }
    mock.state.sources = [open]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Acme Index' })
    )
    expect(mock.service.removeSource).toHaveBeenCalledWith('src-1')
    await waitFor(() => expect(screen.queryByText('Acme Index')).toBeNull())
  })

  it('asks before removing a keyed source', async () => {
    mock.state.sources = [source]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    const remove = await screen.findByRole('button', {
      name: 'Remove Acme Index',
    })
    await userEvent.click(remove)
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Remove Acme Index and its signing key?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mock.service.removeSource).not.toHaveBeenCalled()

    await userEvent.click(remove)
    dialog = await screen.findByRole('dialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove source' })
    )
    expect(mock.service.removeSource).toHaveBeenCalledWith('src-1')
    await waitFor(() => expect(screen.queryByText('Acme Index')).toBeNull())
  })

  it('warns when a URL that had a pinned key is added again without one', async () => {
    mock.state.removedPins = [
      { url: source.url, publicKey: KEY, removedAt: '2026-10-24T10:00:00Z' },
    ]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    const warning =
      'This index had a pinned signing key when you removed it. Without a key its listings are unsigned. Add it again with its key, or press Add source again to continue without one.'
    await userEvent.type(await screen.findByLabelText('Index URL'), source.url)
    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(warning)
    expect(screen.getByRole('alert')).toHaveTextContent(KEY)
    expect(mock.service.addSource).not.toHaveBeenCalled()

    // Editing the URL withdraws the warning; a second press after it adds.
    await userEvent.type(screen.getByLabelText('Index URL'), '?')
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.type(screen.getByLabelText('Index URL'), '{Backspace}')
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    expect(mock.service.addSource).toHaveBeenCalledWith(source.url, 'Acme', undefined)
  })

  it('adds a previously pinned URL with a key without a warning', async () => {
    mock.state.removedPins = [
      { url: source.url, publicKey: KEY, removedAt: '2026-10-24T10:00:00Z' },
    ]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    await userEvent.type(await screen.findByLabelText('Index URL'), source.url)
    await userEvent.type(screen.getByLabelText('Name'), 'Acme')
    await userEvent.type(screen.getByLabelText('Public key (optional)'), KEY)
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    expect(mock.service.addSource).toHaveBeenCalledWith(source.url, 'Acme', KEY)
    expect(screen.queryByText(/had a pinned signing key/)).toBeNull()
  })

  it('says which sources were dropped from a damaged sources file', async () => {
    mock.state.sources = [{ ...source, publicKey: undefined }]
    mock.state.catalogs = { 'src-1': { index, signed: false, nextPublicKey: null } }
    mock.state.sourcesNotice = {
      movedTo: '/data/extensions/sources.json.corrupt-1',
      dropped: [
        { name: 'Weak Index', url: 'https://weak.dev/i.json', reason: 'bad key' },
      ],
    }
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(
      'Some saved sources failed a check and were removed: Weak Index (https://weak.dev/i.json). The previous file was kept at /data/extensions/sources.json.corrupt-1.'
    )
    expect(await screen.findByText('Acme Index')).toBeInTheDocument()
  })

  it('installs the latest version of a catalog entry, labelled with its source', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    mock.state.stage = indexStage(true)
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    expect(await screen.findByText('Says hello')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(mock.service.stageFromIndex).toHaveBeenCalledWith(
      'src-1',
      'acme.hello',
      '0.2.0'
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Verified by Acme Index')
    expect(dialog).toHaveTextContent('Integrity checked')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    expect(mock.service.confirmInstall).toHaveBeenCalledWith(
      'stage-acme.hello',
      ['ui:notify']
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    const mine = await screen.findByRole('region', { name: 'Installed' })
    expect(await within(mine).findByText('Verified by Acme Index')).toBeInTheDocument()
  })

  it('labels an unkeyed source unsigned and requires consent to install from it', async () => {
    const open = { ...source, id: 'src-2', name: 'Open Index' }
    delete (open as { publicKey?: string }).publicKey
    mock.state.sources = [open]
    mock.state.catalogs = { 'src-2': { index, signed: false, nextPublicKey: null } }
    mock.state.stage = indexStage(false)
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    expect(await screen.findByText('Unsigned source')).toBeInTheDocument()
    expect(screen.queryByText('Signing key pinned')).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Install' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Unsigned source')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('From Acme Index')
    expect(dialog).not.toHaveTextContent('Verified by')
    const install = within(dialog).getByRole('button', { name: 'Install' })
    expect(install).toBeDisabled()
    await userEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'I trust the author and this index',
      })
    )
    expect(install).toBeEnabled()
    await userEvent.click(install)
    expect(mock.service.confirmInstall).toHaveBeenCalledWith(
      'stage-acme.hello',
      ['ui:notify']
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    const mine = await screen.findByRole('region', { name: 'Installed' })
    const badge = await within(mine).findByText(
      'Integrity checked (unsigned source)'
    )
    // A warning, not the neutral style of "Verified by": the SRI came from
    // the same unsigned index, so it proves nothing about the author.
    expect(badge.className).toMatch(/amber/)
    expect(within(mine).queryByText(/Verified by/)).toBeNull()
  })

  it('re-pins a key offered as nextPublicKey only after explicit confirmation', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = {
      'src-1': { index, signed: true, nextPublicKey: NEXT },
    }
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    expect(
      await screen.findByText('This index announces a new signing key.')
    ).toBeInTheDocument()
    expect(mock.service.acceptNextKey).not.toHaveBeenCalled()

    // Opening and cancelling the prompt changes nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Review new key' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Change the signing key of Acme Index?')
    expect(dialog).toHaveTextContent(KEY)
    expect(dialog).toHaveTextContent(NEXT)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mock.service.acceptNextKey).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Review new key' }))
    dialog = await screen.findByRole('dialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Pin the new key' })
    )
    expect(mock.service.acceptNextKey).toHaveBeenCalledWith('src-1', NEXT)
    await waitFor(() =>
      expect(
        screen.queryByText('This index announces a new signing key.')
      ).toBeNull()
    )
    expect(mock.state.sources[0].publicKey).toBe(NEXT)
  })

  it('shows reported provenance as a link only', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    const link = await screen.findByRole('link', {
      name: 'Provenance reported by source',
    })
    expect(link).toHaveAttribute('href', 'https://search.sigstore.dev/?hash=b')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows a signature failure of a keyed source as an error', async () => {
    mock.state.sources = [source]
    mock.service.getCatalog.mockRejectedValueOnce(
      new Error("the index signature does not match the source's pinned key")
    )
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Could not load Acme Index: the index signature does not match the source's pinned key"
    )
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('offers an update only when the index has a newer version', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    mock.state.extensions = [installed('acme.hello', { version: '0.2.0' })]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    const current = await screen.findByRole('button', { name: 'Installed' })
    expect(current).toBeDisabled()
  })

  it('shows why staging a catalog install failed', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    mock.service.stageFromIndex.mockRejectedValueOnce(
      new Error('the tarball does not match the integrity the index pinned')
    )
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Install' }))
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        'Could not open the extension: the tarball does not match the integrity the index pinned'
      )
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows why staging a catalog update failed', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    mock.state.extensions = [installed('acme.hello', { version: '0.1.0' })]
    mock.service.stageFromIndex.mockRejectedValueOnce(
      new Error("requests permissions the index did not list: tools")
    )
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Update to 0.2.0' })
    )
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        'Could not open the extension: requests permissions the index did not list: tools'
      )
    )
  })

  it('warns when an update comes from another source than the installed version', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    mock.state.extensions = [
      installed('acme.hello', {
        version: '0.1.0',
        granted: ['ui:notify'],
        source: { kind: 'bundle', fileName: 'hello.tgz', sha512: 'sha512-a' },
      }),
    ]
    mock.state.stage = {
      ...indexStage(true),
      existing: { version: '0.1.0', granted: ['ui:notify'] },
      permissionDiff: { added: [], removed: [] },
    }
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Update to 0.2.0' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Verified by Acme Index')
    expect(dialog).toHaveTextContent(
      'This update comes from Acme Index, but Ext acme.hello was installed from the file hello.tgz.'
    )
  })

  it('shows an unreachable index as an error', async () => {
    mock.state.sources = [source]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load Acme Index: unreachable: src-1'
    )
  })
})

describe('without an install pipeline', () => {
  it('hides install, safe mode and the catalog', async () => {
    mock.service.isSupported.mockReturnValue(false)
    render(<Page />)
    expect(
      screen.queryByRole('button', { name: 'Install from file...' })
    ).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Catalog' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Safe mode' })).toBeNull()
  })
})
