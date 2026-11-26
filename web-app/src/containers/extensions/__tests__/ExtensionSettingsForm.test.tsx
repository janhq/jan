import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SettingContribution } from '@janhq/extension-api'
import type { ExtensionHost } from '@/lib/extensions/host'
import { ExtensionSettingsForm } from '../ExtensionSettingsForm'
import { createTestHost } from './harness'

const hostRef = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('@/lib/extensions/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extensions/host')>()),
  getExtensionHost: () => hostRef.current,
}))
vi.mock('@/i18n/react-i18next-compat', async () => {
  const i18n = (await import('@/i18n/setup')).default
  return { useTranslation: () => ({ t: i18n.t, i18n }) }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const settings: SettingContribution[] = [
  {
    key: 'endpoint',
    title: 'Endpoint',
    description: 'Where to send requests',
    control: { type: 'input', inputType: 'url', default: 'https://a.test' },
  },
  {
    key: 'apiKey',
    title: 'API key',
    secret: true,
    control: { type: 'input', default: '' },
  },
  {
    key: 'verbose',
    title: 'Verbose',
    control: { type: 'checkbox', default: false },
  },
]

let test: ReturnType<typeof createTestHost>
let host: ExtensionHost

beforeEach(async () => {
  test = createTestHost()
  host = test.host
  hostRef.current = host
  await test.activate('acme.form', 'Acme', { settings })
})

afterEach(async () => {
  await act(() => host.deactivateAll())
})

describe('ExtensionSettingsForm', () => {
  it('shows each setting with its stored value or default', async () => {
    await host.settings.setSettingValue(
      'acme.form',
      'endpoint',
      'https://b.test'
    )
    render(
      <ExtensionSettingsForm extensionId="acme.form" settings={settings} />
    )
    expect(screen.getByText('Endpoint')).toBeInTheDocument()
    expect(screen.getByText('Where to send requests')).toBeInTheDocument()
    expect(
      await screen.findByDisplayValue('https://b.test')
    ).toBeInTheDocument()
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('writes through the settings store', async () => {
    const changes = vi.fn()
    host.settings.onDidChange(changes)
    render(
      <ExtensionSettingsForm extensionId="acme.form" settings={settings} />
    )
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(changes).toHaveBeenCalledWith({
        extensionId: 'acme.form',
        key: 'verbose',
        value: true,
      })
    )
    expect(await host.settings.getSettingValue('acme.form', 'verbose')).toBe(
      true
    )
    expect(
      JSON.parse(
        test.appSettings.data.get('extension:acme.form:settings') ?? '{}'
      )
    ).toEqual({ verbose: true })
  })

  it('keeps a secret setting out of appSettings and masks it', async () => {
    render(
      <ExtensionSettingsForm extensionId="acme.form" settings={settings} />
    )
    const secret = document.querySelector<HTMLInputElement>(
      'input[type=password]'
    )
    expect(secret).not.toBeNull()
    if (!secret) return
    await userEvent.type(secret, 'k')
    await waitFor(() =>
      expect(test.secrets.data.get('ext:acme.form:apiKey')).toBe('k')
    )
    expect(
      test.appSettings.data.get('extension:acme.form:settings')
    ).toBeUndefined()
  })
})
