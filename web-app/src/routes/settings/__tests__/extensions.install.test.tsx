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
  service: undefined as unknown,
}))

vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({
    list: () => h.hosted,
    onDidChange: () => ({ dispose: () => undefined }),
    unload: h.unload,
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
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ listExtensions: () => [] }) },
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

  it('shows a translated error when staging fails', async () => {
    h.open.mockResolvedValue('/downloads/bad.tgz')
    render(<Page />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Install from file...' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open the extension: nothing to stage'
    )
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
  })

  it('turns safe mode on from its switch', async () => {
    render(<Page />)
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Safe mode' })
    )
    expect(mock.service.setSafeMode).toHaveBeenCalledWith(true)
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })
})

describe('catalog', () => {
  const catalog = {
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
            apiVersion: '^0.1.0',
            permissions: [],
          },
          {
            version: '0.2.0',
            tarball: 'https://a.b/0.2.0.tgz',
            integrity: 'sha512-b',
            apiVersion: '^0.1.0',
            permissions: [],
          },
        ],
      },
    ],
  }
  const source = {
    id: 'src-1',
    name: 'Acme Index',
    url: 'https://acme.dev/index.json',
    addedAt: '2026-10-23T10:00:00Z',
  }

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

  it('removes a source', async () => {
    mock.state.sources = [source]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Acme Index' })
    )
    expect(mock.service.removeSource).toHaveBeenCalledWith('src-1')
    await waitFor(() => expect(screen.queryByText('Acme Index')).toBeNull())
  })

  it('installs the latest version of a catalog entry, labelled with its source', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    mock.state.stage = staged('acme.hello', ['ui:notify'], { verified: true })
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
    expect(dialog).toHaveTextContent('From Acme Index')
    expect(dialog).toHaveTextContent('Integrity checked')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    expect(mock.service.confirmInstall).toHaveBeenCalledWith(
      'stage-acme.hello',
      ['ui:notify']
    )
  })

  it('offers an update only when the index has a newer version', async () => {
    mock.state.sources = [source]
    mock.state.catalogs = { 'src-1': catalog }
    mock.state.extensions = [installed('acme.hello', { active: '0.2.0' })]
    render(<Page />)
    await userEvent.click(screen.getByRole('tab', { name: 'Catalog' }))
    const current = await screen.findByRole('button', { name: 'Installed' })
    expect(current).toBeDisabled()
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
