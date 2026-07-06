import { describe, it, expect, vi, beforeEach } from 'vitest'

const isPlatformTauri = vi.fn()
const invoke = vi.fn()
const backend = new Map<string, string>()

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => isPlatformTauri(),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke }) }),
}))
vi.mock('@/hooks/useGeneralSetting', () => ({
  HUGGINGFACE_TOKEN_SECRET_KEY: 'huggingface',
}))

import { migrateLocalStorageToBackend } from '../migrateLocalStorageSettings'

// invoke mock backed by an in-memory settings map
function wireInvoke() {
  invoke.mockImplementation(async (cmd: string, args: any) => {
    if (cmd === 'settings_get') return backend.get(args.key) ?? null
    if (cmd === 'settings_set') {
      backend.set(args.key, args.value)
      return
    }
    return
  })
}

describe('migrateLocalStorageToBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backend.clear()
    localStorage.clear()
    isPlatformTauri.mockReturnValue(true)
    wireInvoke()
  })

  it('no-ops on web (no Tauri)', async () => {
    isPlatformTauri.mockReturnValue(false)
    localStorage.setItem('theme', '{"state":{"activeTheme":"dark"}}')
    await migrateLocalStorageToBackend()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('copies plain store blobs and sets the flag', async () => {
    localStorage.setItem('theme', '{"state":{"activeTheme":"dark"},"version":0}')
    localStorage.setItem('left-panel', '{"state":{"open":false}}')
    await migrateLocalStorageToBackend()
    expect(backend.get('theme')).toBe('{"state":{"activeTheme":"dark"},"version":0}')
    expect(backend.get('left-panel')).toBe('{"state":{"open":false}}')
    expect(backend.get('__settings_migrated_to_backend__')).toBe('true')
  })

  it('extracts provider keys to keyring and strips them from the blob', async () => {
    const blob = {
      state: {
        providers: [
          {
            provider: 'openai',
            api_key: 'sk-primary',
            api_key_fallbacks: ['sk-fb'],
            base_url: 'https://api.openai.com/v1',
            custom_header: [{ header: 'X', value: 'y' }],
            models: [{ id: 'gpt-4' }],
            settings: [
              { key: 'api-key', controller_props: { value: 'sk-primary' } },
              { key: 'base-url', controller_props: { value: 'https://x' } },
            ],
          },
          { provider: 'llamacpp', models: [] },
        ],
      },
      version: 17,
    }
    localStorage.setItem('model-provider', JSON.stringify(blob))

    await migrateLocalStorageToBackend()

    expect(invoke).toHaveBeenCalledWith('register_provider_config', {
      request: expect.objectContaining({
        provider: 'openai',
        api_key: 'sk-primary',
        api_keys: ['sk-fb'],
        base_url: 'https://api.openai.com/v1',
        models: ['gpt-4'],
      }),
    })

    const stored = backend.get('model-provider')!
    expect(stored).not.toContain('sk-primary')
    expect(stored).not.toContain('sk-fb')
    // non-secret config preserved
    expect(stored).toContain('https://api.openai.com/v1')
    expect(stored).toContain('gpt-4')
  })

  it('falls back to the api-key settings value when top-level api_key is absent', async () => {
    const blob = {
      state: {
        providers: [
          {
            provider: 'openai',
            base_url: 'https://api.openai.com/v1',
            models: [{ id: 'gpt-4' }],
            settings: [
              { key: 'api-key', controller_props: { value: 'sk-from-settings' } },
              {
                key: 'api-key-fallbacks',
                controller_props: { value: 'sk-fb1\nsk-fb2' },
              },
            ],
          },
        ],
      },
      version: 17,
    }
    localStorage.setItem('model-provider', JSON.stringify(blob))

    await migrateLocalStorageToBackend()

    expect(invoke).toHaveBeenCalledWith('register_provider_config', {
      request: expect.objectContaining({
        provider: 'openai',
        api_key: 'sk-from-settings',
        api_keys: ['sk-fb1', 'sk-fb2'],
      }),
    })

    const stored = backend.get('model-provider')!
    expect(stored).not.toContain('sk-from-settings')
    expect(stored).not.toContain('sk-fb1')
  })

  it('extracts the HF token to keyring and strips it', async () => {
    localStorage.setItem(
      'setting-general',
      JSON.stringify({ state: { huggingfaceToken: 'hf_secret', autoUpdateCheck: true } })
    )
    await migrateLocalStorageToBackend()
    expect(invoke).toHaveBeenCalledWith('set_secret', {
      key: 'huggingface',
      value: 'hf_secret',
    })
    const stored = backend.get('setting-general')!
    expect(stored).not.toContain('hf_secret')
    expect(stored).toContain('autoUpdateCheck')
  })

  it('is idempotent: skips entirely when the flag is set', async () => {
    backend.set('__settings_migrated_to_backend__', 'true')
    localStorage.setItem('theme', '{"state":{"activeTheme":"dark"}}')
    await migrateLocalStorageToBackend()
    expect(backend.has('theme')).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(1) // only the flag check
  })

  it('overwrites a pre-feature fossil when the flag is unset (localStorage wins)', async () => {
    // #7821 shipped and was reverted within v0.8.0, but nightly testers can have
    // a stale model-provider/theme blob in settings.json with no migration flag.
    // localStorage is authoritative, so migration must overwrite the fossil.
    localStorage.setItem('theme', '{"state":{"activeTheme":"dark"}}')
    backend.set('theme', '{"state":{"activeTheme":"light"}}')
    await migrateLocalStorageToBackend()
    expect(backend.get('theme')).toBe('{"state":{"activeTheme":"dark"}}')
  })

  it('extracts keys from a fossil model-provider blob (flag unset, backend present)', async () => {
    backend.set('model-provider', '{"state":{"providers":[]},"version":17}')
    const blob = {
      state: {
        providers: [
          {
            provider: 'openai',
            api_key: 'sk-real',
            models: [{ id: 'gpt-4' }],
          },
        ],
      },
      version: 17,
    }
    localStorage.setItem('model-provider', JSON.stringify(blob))

    await migrateLocalStorageToBackend()

    expect(invoke).toHaveBeenCalledWith('register_provider_config', {
      request: expect.objectContaining({ provider: 'openai', api_key: 'sk-real' }),
    })
    const stored = backend.get('model-provider')!
    expect(stored).not.toContain('sk-real')
    expect(stored).toContain('gpt-4')
  })
})
