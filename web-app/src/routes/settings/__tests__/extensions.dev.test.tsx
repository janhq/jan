// Dev-only "Load unpacked" on Settings > Extensions. IS_DEV is a build
// constant; the tests stub the global the define would have replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType, ReactNode } from 'react'
import type { HostedExtension } from '@/lib/extensions/host'
import { manifest } from '@/lib/extensions/__tests__/fixtures'
import { DefaultExtensionsService } from '@/services/extensions/default'

const files = vi.hoisted(() => ({ map: new Map<string, string>() }))
const picker = vi.hoisted(() => ({ open: vi.fn() }))
const host = vi.hoisted(() => {
  let entries: HostedExtension[] = []
  const listeners = new Set<() => void>()
  const set = (next: HostedExtension[]) => {
    entries = next
    listeners.forEach((l) => l())
  }
  return {
    set,
    list: () => entries,
    onDidChange: (listener: () => void) => {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
    spawnWorkerExtension: vi.fn(),
    unload: vi.fn(async (id: string) =>
      set(entries.filter((e) => e.id !== id))
    ),
  }
})

vi.mock('@janhq/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@janhq/core')>()),
  joinPath: async (parts: string[]) => parts.join('/'),
  fs: {
    readFileSync: async (path: string) => {
      const content = files.map.get(path)
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
    },
  },
}))
vi.mock('@/lib/extensions/host', () => ({ getExtensionHost: () => host }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: picker.open }),
    extensions: () => new DefaultExtensionsService(),
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
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

import { Route } from '../extensions/index'

const DIR = '/home/dev/hello'
const Page = Route.component as ComponentType

const writePackage = (jan: Record<string, unknown>) =>
  files.map.set(
    `${DIR}/package.json`,
    JSON.stringify({
      name: 'hello-provider',
      version: '0.1.0',
      jan: {
        id: 'acme.hello',
        displayName: 'Hello Provider',
        publisher: 'Acme',
        apiVersion: '^1.0.0',
        main: 'dist/index.js',
        permissions: ['ui:notify', 'network:*'],
        ...jan,
      },
    })
  )

beforeEach(() => {
  files.map.clear()
  host.set([])
  host.spawnWorkerExtension.mockReset()
  picker.open.mockReset()
  vi.stubGlobal('IS_DEV', true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Load unpacked', () => {
  it('is hidden when IS_DEV is false', () => {
    vi.stubGlobal('IS_DEV', false)
    render(<Page />)
    expect(screen.queryByRole('button', { name: 'Load unpacked' })).toBeNull()
  })

  it('shows an i18n error for an invalid manifest and spawns nothing', async () => {
    writePackage({ id: 'Not Valid' })
    picker.open.mockResolvedValue(DIR)
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Load unpacked' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The manifest is invalid:')
    expect(alert).toHaveTextContent('jan.id')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(host.spawnWorkerExtension).not.toHaveBeenCalled()
  })

  it('rejects a main path escaping the folder', async () => {
    writePackage({ main: '../elsewhere/index.js' })
    picker.open.mockResolvedValue(DIR)
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Load unpacked' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('jan.main')
  })

  it('does nothing when the picker is cancelled', async () => {
    picker.open.mockResolvedValue(null)
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Load unpacked' }))
    expect(picker.open).toHaveBeenCalledWith({ directory: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('confirms the requested permissions, then spawns a dev worker', async () => {
    writePackage({})
    files.map.set(`${DIR}/dist/index.js`, 'var JanExtension = {}')
    picker.open.mockResolvedValue(DIR)
    host.spawnWorkerExtension.mockImplementation(async (options) => {
      const hosted: HostedExtension = {
        id: options.manifest.id,
        manifest: options.manifest,
        source: 'dev',
        state: 'active',
      }
      host.set([hosted])
      return hosted
    })
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Load unpacked' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Load Hello Provider from a folder?')
    expect(dialog).toHaveTextContent('Show notifications')
    expect(dialog).toHaveTextContent('Low risk')
    expect(dialog).toHaveTextContent('Connect to *')
    expect(dialog).toHaveTextContent('High risk')
    // network:* also covers local servers; the consent says so.
    expect(dialog).toHaveTextContent(
      "Includes servers on this computer on any port: localhost and 127.0.0.1 over http or https, other local addresses such as ::1 over https only. Jan's own local API server is always blocked."
    )
    expect(host.spawnWorkerExtension).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(host.spawnWorkerExtension).toHaveBeenCalledWith(
      expect.objectContaining({
        bundle: 'var JanExtension = {}',
        grants: ['ui:notify', 'network:*'],
        source: 'dev',
        manifest: expect.objectContaining({ id: 'acme.hello' }),
      })
    )
    expect(await screen.findByText('Hello Provider')).toBeInTheDocument()
    expect(screen.getByText('Development')).toBeInTheDocument()
  })

  it('shows an i18n error for a bundle with more than var JanExtension', async () => {
    writePackage({})
    files.map.set(`${DIR}/dist/index.js`, 'function Set() {}\nvar JanExtension = {}')
    picker.open.mockResolvedValue(DIR)
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Load unpacked' }))
    expect(
      await screen.findByText(/dist\/index\.js is not a valid extension bundle/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(host.spawnWorkerExtension).not.toHaveBeenCalled()
  })

  it('spawns nothing when the confirm dialog is cancelled', async () => {
    writePackage({})
    files.map.set(`${DIR}/dist/index.js`, 'var JanExtension = {}')
    picker.open.mockResolvedValue(DIR)
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Load unpacked' }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(host.spawnWorkerExtension).not.toHaveBeenCalled()
  })
})

describe('worker extensions on the page', () => {
  const setting = {
    key: 'apiKey',
    title: 'API key',
    control: { type: 'input' as const, default: '' },
  }

  it('unload removes a dev extension from the page', async () => {
    host.set([
      {
        id: 'acme.dev',
        manifest: manifest('acme.dev', { displayName: 'Dev One' }),
        source: 'dev',
        state: 'active',
      },
    ])
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Unload' }))
    expect(host.unload).toHaveBeenCalledWith('acme.dev')
    await waitFor(() => expect(screen.queryByText('Dev One')).toBeNull())
  })

  it('shows contributed settings of an active worker extension like a built-in', () => {
    host.set([
      {
        id: 'acme.dev',
        manifest: manifest('acme.dev', { contributes: { settings: [setting] } }),
        source: 'dev',
        state: 'active',
      },
      {
        id: 'jan.builtin',
        manifest: manifest('jan.builtin', {
          contributes: { settings: [setting] },
        }),
        source: 'builtin',
        state: 'active',
      },
    ])
    render(<Page />)
    expect(screen.getByTestId('settings-form-acme.dev')).toBeInTheDocument()
    expect(screen.getByTestId('settings-form-jan.builtin')).toBeInTheDocument()
    // Only the dev extension is labelled and unloadable.
    expect(screen.getAllByText('Development')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Unload' })).toHaveLength(1)
  })
})
