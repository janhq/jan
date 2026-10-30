// Settings > Extensions > <id>: grants with revoke, version and rollback,
// uninstall; built-ins are read-only.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType, ReactNode } from 'react'
import type { HostedExtension } from '@/lib/extensions/host'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { manifest } from '@/lib/extensions/__tests__/fixtures'
import {
  createMockExtensionsService,
  installed,
} from '@/services/extensions/__tests__/mock'

const h = vi.hoisted(() => ({
  hosted: [] as HostedExtension[],
  params: { extensionId: 'acme.hello' },
  navigate: vi.fn(),
  reload: vi.fn(async (_id: string) => undefined),
  service: undefined as unknown,
}))

vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({
    list: () => h.hosted,
    onDidChange: () => ({ dispose: () => undefined }),
  }),
}))
vi.mock('@/lib/extensions/installed-reload', () => ({
  reloadInstalled: h.reload,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ extensions: () => h.service }),
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
  createFileRoute: () => (config: { component: ComponentType }) => ({
    ...config,
    useParams: () => h.params,
  }),
  useNavigate: () => h.navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

import { Route } from '../extensions/$extensionId'

const Page = Route.component as ComponentType
let mock: ReturnType<typeof createMockExtensionsService>

beforeEach(() => {
  h.hosted = []
  h.params = { extensionId: 'acme.hello' }
  h.navigate.mockReset()
  h.reload.mockClear()
  mock = createMockExtensionsService({
    extensions: [
      installed('acme.hello', {
        manifest: manifest('acme.hello', {
          displayName: 'Hello',
          permissions: ['ui:notify', 'tools'],
          contributes: {
            settings: [
              { key: 'k', title: 'K', control: { type: 'checkbox', default: false } },
            ],
          },
        }),
        version: '2.0.0',
        previous: '1.0.0',
        granted: ['ui:notify', 'tools'],
      }),
    ],
  })
  h.service = mock.service
})

describe('installed extension details', () => {
  it('revoke calls setGrants with the rest, then reloads the extension', async () => {
    render(<Page />)
    const grants = await screen.findByRole('list', {
      name: 'Granted permissions',
    })
    expect(grants).toHaveTextContent('Show notifications')
    expect(grants).toHaveTextContent('Add tools for models')
    const revokeButtons = within(grants).getAllByRole('button', {
      name: 'Revoke',
    })
    await userEvent.click(revokeButtons[1])
    expect(mock.service.setGrants).toHaveBeenCalledWith('acme.hello', [
      'ui:notify',
    ])
    await waitFor(() => expect(h.reload).toHaveBeenCalledWith('acme.hello'))
    expect(mock.service.setGrants.mock.invocationCallOrder[0]).toBeLessThan(
      h.reload.mock.invocationCallOrder[0]
    )
    await waitFor(() =>
      expect(grants).not.toHaveTextContent('Add tools for models')
    )
  })

  it('disables the controls while a change is in flight', async () => {
    let finish = () => {}
    mock.service.setGrants.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    render(<Page />)
    const grants = await screen.findByRole('list', {
      name: 'Granted permissions',
    })
    const [first] = within(grants).getAllByRole('button', { name: 'Revoke' })
    await userEvent.click(first)
    await waitFor(() => expect(first).toBeDisabled())
    expect(screen.getByRole('switch', { name: 'Enable Hello' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Roll back to 1.0.0' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Uninstall' })).toBeEnabled())
  })

  it('shows the version and rolls back to the previous one', async () => {
    render(<Page />)
    expect(await screen.findByText('Version 2.0.0')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Roll back to 1.0.0' })
    )
    expect(mock.service.rollback).toHaveBeenCalledWith('acme.hello')
    await waitFor(() => expect(h.reload).toHaveBeenCalledWith('acme.hello'))
    expect(await screen.findByText('Version 1.0.0')).toBeInTheDocument()
  })

  it('has no rollback without a previous version', async () => {
    mock.state.extensions[0].previous = null
    render(<Page />)
    await screen.findByText('Version 2.0.0')
    expect(screen.queryByRole('button', { name: /Roll back/ })).toBeNull()
  })

  it('uninstalls after confirmation, stops it and goes back to the list', async () => {
    render(<Page />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Uninstall' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Uninstall Hello?')
    expect(mock.service.uninstall).not.toHaveBeenCalled()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Uninstall' })
    )
    expect(mock.service.uninstall).toHaveBeenCalledWith('acme.hello')
    await waitFor(() => expect(h.reload).toHaveBeenCalledWith('acme.hello'))
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({ to: '/settings/extensions' })
    )
  })

  it('shows the settings form while the extension runs', async () => {
    h.hosted = [
      {
        id: 'acme.hello',
        manifest: mock.state.extensions[0].manifest,
        source: 'installed',
        state: 'active',
      },
    ]
    render(<Page />)
    expect(await screen.findByTestId('settings-form-acme.hello')).toBeInTheDocument()
  })

  it('shows the name and description in the app language', async () => {
    useGeneralSetting.setState({ currentLanguage: 'ja' })
    mock.state.extensions[0].manifest = {
      ...mock.state.extensions[0].manifest,
      displayName: '%name%',
      description: '%about%',
      l10n: {
        en: { name: 'Hello', about: 'Says hello' },
        ja: { name: 'Konnichiwa' },
      },
    }
    render(<Page />)
    expect(
      await screen.findByRole('heading', { name: 'Konnichiwa' })
    ).toBeInTheDocument()
    expect(screen.getByText('Says hello')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Enable Konnichiwa' })
    ).toBeInTheDocument()
    useGeneralSetting.setState({ currentLanguage: 'en' })
  })

  it('says when the id is not installed', async () => {
    h.params = { extensionId: 'acme.gone' }
    render(<Page />)
    expect(
      await screen.findByText('This extension is not installed.')
    ).toBeInTheDocument()
  })
})

describe('built-in details', () => {
  it('has no revoke, rollback, uninstall or enable', async () => {
    h.params = { extensionId: 'jan.core' }
    h.hosted = [
      {
        id: 'jan.core',
        manifest: manifest('jan.core', {
          displayName: 'Core',
          permissions: ['ui:notify'],
        }),
        source: 'builtin',
        state: 'active',
      },
    ]
    render(<Page />)
    expect(
      screen.getByText(
        'Built-in extensions are part of Jan and cannot be disabled or uninstalled.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Show notifications')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
