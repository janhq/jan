import { describe, expect, it, vi } from 'vitest'
import { ExtensionSettingsStore } from '../settings-store'
import { manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

const withSettings = () =>
  manifest('acme.one', {
    contributes: {
      settings: [
        {
          key: 'greeting',
          title: 'Greeting',
          control: { type: 'input', default: 'Hello' },
        },
        {
          key: 'loud',
          title: 'Loud',
          control: { type: 'checkbox', default: false },
        },
        {
          key: 'level',
          title: 'Level',
          control: { type: 'slider', min: 0, max: 10, step: 1, default: 5 },
        },
        {
          key: 'mode',
          title: 'Mode',
          control: {
            type: 'dropdown',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
            default: 'a',
          },
        },
        {
          key: 'token',
          title: 'Token',
          secret: true,
          control: { type: 'input', default: '' },
        },
      ],
    },
  })

const setup = () => {
  const appSettings = memoryAppSettings()
  const secrets = memorySecrets()
  const store = new ExtensionSettingsStore({ appSettings, secrets })
  store.register(withSettings())
  return { appSettings, secrets, store }
}

describe('ExtensionSettingsStore', () => {
  it('falls back to the manifest default and undefined for unknown keys', async () => {
    const { store } = setup()
    expect(await store.getSettingValue('acme.one', 'greeting')).toBe('Hello')
    expect(await store.getSettingValue('acme.one', 'loud')).toBe(false)
    expect(await store.getSettingValue('acme.one', 'nope')).toBeUndefined()
    expect(await store.getSettingValue('acme.two', 'greeting')).toBeUndefined()
  })

  it('persists values as JSON under extension:<id>:settings', async () => {
    const { appSettings, secrets, store } = setup()
    await store.setSettingValue('acme.one', 'greeting', 'Hi')
    await store.setSettingValue('acme.one', 'level', 7)
    expect(
      JSON.parse(appSettings.data.get('extension:acme.one:settings') ?? '')
    ).toEqual({ greeting: 'Hi', level: 7 })

    const reloaded = new ExtensionSettingsStore({ appSettings, secrets })
    reloaded.register(withSettings())
    expect(await reloaded.getSettingValue('acme.one', 'greeting')).toBe('Hi')
  })

  it('keeps secrets in the keyring under ext:<id>:<key> and never in appSettings', async () => {
    const { appSettings, secrets, store } = setup()
    await store.setSettingValue('acme.one', 'token', 's3cret')
    expect(secrets.data.get('ext:acme.one:token')).toBe('s3cret')
    expect([...appSettings.data.values()].join()).not.toContain('s3cret')
    expect(await store.getSettingValue('acme.one', 'token')).toBe('s3cret')
    await store.setSettingValue('acme.one', 'token', '')
    expect(secrets.data.has('ext:acme.one:token')).toBe(false)
  })

  it('rejects undeclared keys and values that do not fit the control', async () => {
    const { store } = setup()
    const invalid = expect.objectContaining({ code: 'E_INVALID_ARGS' })
    await expect(
      store.setSettingValue('acme.one', 'nope', 'x')
    ).rejects.toEqual(expect.objectContaining({ code: 'E_NOT_FOUND' }))
    await expect(
      store.setSettingValue('acme.one', 'loud', 'yes')
    ).rejects.toEqual(invalid)
    await expect(
      store.setSettingValue('acme.one', 'level', 11)
    ).rejects.toEqual(invalid)
    await expect(
      store.setSettingValue('acme.one', 'mode', 'c')
    ).rejects.toEqual(invalid)
  })

  it('fires onDidChange once per changed key', async () => {
    const { store } = setup()
    const listener = vi.fn()
    store.onDidChange(listener)
    await store.setSettingValue('acme.one', 'loud', true)
    await store.setSettingValue('acme.one', 'token', 'x')
    expect(listener.mock.calls).toEqual([
      [{ extensionId: 'acme.one', key: 'loud', value: true }],
      [{ extensionId: 'acme.one', key: 'token', value: 'x' }],
    ])
  })

  it('serves nothing for an extension after its registration is disposed', async () => {
    const appSettings = memoryAppSettings()
    const store = new ExtensionSettingsStore({
      appSettings,
      secrets: memorySecrets(),
    })
    const registration = store.register(withSettings())
    registration.dispose()
    expect(await store.getSettingValue('acme.one', 'greeting')).toBeUndefined()
  })
})
