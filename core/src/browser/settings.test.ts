import { describe, it, expect, beforeEach, vi } from 'vitest'
import { appSettings } from './settings'

describe('appSettings', () => {
  beforeEach(() => {
    globalThis.core = {
      api: {
        settingsGet: vi.fn(),
        settingsSet: vi.fn(),
        settingsRemove: vi.fn(),
      },
    }
  })

  it('passes the key through to settingsGet', async () => {
    globalThis.core.api.settingsGet.mockResolvedValue('vulkan')
    await expect(appSettings.get('backend')).resolves.toBe('vulkan')
    expect(globalThis.core.api.settingsGet).toHaveBeenCalledWith({ key: 'backend' })
  })

  // The Rust command returns Option<String>, which serializes to null; callers
  // distinguish "unset" from "empty", so undefined must not leak through.
  it('normalizes a missing key to null', async () => {
    globalThis.core.api.settingsGet.mockResolvedValue(undefined)
    await expect(appSettings.get('absent')).resolves.toBeNull()
  })

  it('passes key and value through to settingsSet', async () => {
    await appSettings.set('backend', 'cuda-12')
    expect(globalThis.core.api.settingsSet).toHaveBeenCalledWith({
      key: 'backend',
      value: 'cuda-12',
    })
  })

  it('passes the key through to settingsRemove', async () => {
    await appSettings.remove('backend')
    expect(globalThis.core.api.settingsRemove).toHaveBeenCalledWith({ key: 'backend' })
  })
})
