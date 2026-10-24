import { describe, expect, it } from 'vitest'
import { createExtensionStorage, STORAGE_QUOTA_BYTES } from '../storage'
import { memoryAppSettings } from './memory'

describe('createExtensionStorage', () => {
  it('stores JSON values under extension:<id>:storage', async () => {
    const backend = memoryAppSettings()
    const storage = createExtensionStorage('acme.one', backend)
    await storage.set('a', { n: 1 })
    await storage.set('b', [true])
    expect(await storage.get('a')).toEqual({ n: 1 })
    expect(await storage.keys()).toEqual(['a', 'b'])
    expect(
      JSON.parse(backend.data.get('extension:acme.one:storage') ?? '')
    ).toEqual({ a: { n: 1 }, b: [true] })
    await storage.delete('a')
    expect(await storage.get('a')).toBeUndefined()
    expect(await createExtensionStorage('acme.one', backend).keys()).toEqual([
      'b',
    ])
  })

  it('rejects a write that would exceed the quota and keeps the old data', async () => {
    const backend = memoryAppSettings()
    const storage = createExtensionStorage('acme.one', backend)
    await storage.set('small', 'x')
    await expect(
      storage.set('big', 'x'.repeat(STORAGE_QUOTA_BYTES))
    ).rejects.toMatchObject({ code: 'E_TOO_LARGE' })
    expect(await storage.keys()).toEqual(['small'])
  })

  it('serializes concurrent writes so none is lost', async () => {
    const backend = memoryAppSettings()
    const storage = createExtensionStorage('acme.one', backend)
    await Promise.all([
      storage.set('a', 1),
      storage.set('b', 2),
      storage.set('c', 3),
    ])
    expect(await createExtensionStorage('acme.one', backend).keys()).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
