import { beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_SETTINGS_KEY, migrateLegacySettings } from './settings'
import { fakeSettings } from './test/fake-context'

const legacy = (entries: { key: string; value: unknown }[]) =>
  localStorage.setItem(
    LEGACY_SETTINGS_KEY,
    JSON.stringify(
      entries.map(({ key, value }) => ({
        key,
        title: key,
        controllerType: 'input',
        controllerProps: { value },
      }))
    )
  )

describe('migrateLegacySettings', () => {
  beforeEach(() => localStorage.clear())

  it('copies the legacy array values into the settings store and removes the key', async () => {
    legacy([
      { key: 'enabled', value: false },
      { key: 'parse_mode', value: 'embeddings' },
      { key: 'retrieval_limit', value: 7 },
      { key: 'retrieval_threshold', value: 0.5 },
      { key: 'search_mode', value: 'linear' },
      { key: 'auto_inline_context_ratio', value: 0.4 },
    ])
    const { api, values } = fakeSettings()
    await migrateLegacySettings(api)
    expect(Object.fromEntries(values)).toEqual({
      enabled: false,
      parse_mode: 'embeddings',
      retrieval_limit: 7,
      retrieval_threshold: 0.5,
      search_mode: 'linear',
      auto_inline_context_ratio: 0.4,
    })
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull()
  })

  it('is a no-op on a second run', async () => {
    legacy([{ key: 'retrieval_limit', value: 7 }])
    const { api, values } = fakeSettings()
    await migrateLegacySettings(api)
    await api.set('retrieval_limit', 9)
    await migrateLegacySettings(api)
    expect(values.get('retrieval_limit')).toBe(9)
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull()
  })

  it('does nothing without the legacy key', async () => {
    const { api, values } = fakeSettings()
    await migrateLegacySettings(api)
    expect(values.size).toBe(0)
  })

  it('turns numeric strings into numbers', async () => {
    legacy([{ key: 'max_file_size_mb', value: '50' }])
    const { api, values } = fakeSettings()
    await migrateLegacySettings(api)
    expect(values.get('max_file_size_mb')).toBe(50)
  })

  it('reads the token-named chunk keys of older profiles, the char keys winning', async () => {
    legacy([
      { key: 'chunk_size_tokens', value: 256 },
      { key: 'overlap_chars', value: 32 },
      { key: 'overlap_tokens', value: 16 },
    ])
    const { api, values } = fakeSettings()
    await migrateLegacySettings(api)
    expect(values.get('chunk_size_chars')).toBe(256)
    expect(values.get('overlap_chars')).toBe(32)
  })

  it('leaves the default for values the control rejects and ignores unknown keys', async () => {
    legacy([
      { key: 'retrieval_limit', value: 500 },
      { key: 'search_mode', value: 'bogus' },
      { key: 'enabled', value: 'yes' },
      { key: 'unknown', value: 1 },
    ])
    const { api, values } = fakeSettings()
    await migrateLegacySettings(api)
    expect(values.size).toBe(0)
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull()
  })

  it('drops an unreadable legacy value', async () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, '{not json')
    const { api, values } = fakeSettings()
    await migrateLegacySettings(api)
    expect(values.size).toBe(0)
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull()
  })
})
