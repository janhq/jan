import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real zustand persist, fake disk standing in for the backend settings store.
const disk = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: async (name: string) => disk.get(name) ?? null,
    setItem: async (name: string, value: string) => {
      disk.set(name, value)
    },
    removeItem: async (name: string) => {
      disk.delete(name)
    },
  },
}))
vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({ list: () => [] }),
}))

import {
  useImageAttachmentConfig,
  clampImageSizeMB,
  DEFAULT_MAX_IMAGE_SIZE_MB,
  MIN_MAX_IMAGE_SIZE_MB,
  MAX_MAX_IMAGE_SIZE_MB,
} from '../useImageAttachmentConfig'
import { useAttachments } from '../useAttachments'
import { hydrateBackendStores } from '@/lib/hydrateStores'

describe('useImageAttachmentConfig', () => {
  beforeEach(() => {
    disk.clear()
    useImageAttachmentConfig.setState({
      maxImageSizeMB: DEFAULT_MAX_IMAGE_SIZE_MB,
    })
  })

  it('defaults to 10MB so behavior is unchanged', () => {
    expect(DEFAULT_MAX_IMAGE_SIZE_MB).toBe(10)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(10)
  })

  it('updates the limit', () => {
    useImageAttachmentConfig.getState().setMaxImageSizeMB(25)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(25)
  })

  it('clamps to the 1-100MB range and floors fractions', () => {
    const { setMaxImageSizeMB } = useImageAttachmentConfig.getState()
    setMaxImageSizeMB(0)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(
      MIN_MAX_IMAGE_SIZE_MB
    )
    setMaxImageSizeMB(500)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(
      MAX_MAX_IMAGE_SIZE_MB
    )
    setMaxImageSizeMB(12.9)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(12)
  })

  it('ignores non-numeric input', () => {
    useImageAttachmentConfig.getState().setMaxImageSizeMB(30)
    useImageAttachmentConfig.getState().setMaxImageSizeMB(NaN)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(30)
    expect(clampImageSizeMB('abc', 7)).toBe(7)
  })

  it('flushes the value to the backend store', async () => {
    useImageAttachmentConfig.getState().setMaxImageSizeMB(40)
    await vi.waitFor(() => {
      expect(
        JSON.parse(disk.get('setting-image-attachments') ?? '{}').state
      ).toEqual({ maxImageSizeMB: 40 })
    })
  })

  it('hydrates a saved value, surviving a restart', async () => {
    disk.set(
      'setting-image-attachments',
      JSON.stringify({ state: { maxImageSizeMB: 50 }, version: 0 })
    )
    await useImageAttachmentConfig.persist.rehydrate()
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(50)
  })

  it('keeps the default when nothing is saved', async () => {
    await useImageAttachmentConfig.persist.rehydrate()
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(10)
  })

  it('sanitizes an out-of-range saved value instead of disabling the limit', async () => {
    disk.set(
      'setting-image-attachments',
      JSON.stringify({ state: { maxImageSizeMB: 0 }, version: 0 })
    )
    await useImageAttachmentConfig.persist.rehydrate()
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(1)
    // A record that is not a number falls back to the current value, so reset
    // it first: the assertion must not depend on the previous rehydrate.
    useImageAttachmentConfig.setState({ maxImageSizeMB: 10 })
    disk.set(
      'setting-image-attachments',
      JSON.stringify({ state: { maxImageSizeMB: 'junk' }, version: 0 })
    )
    await useImageAttachmentConfig.persist.rehydrate()
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(10)
  })

  it('is rehydrated by hydrateBackendStores', async () => {
    disk.set(
      'setting-image-attachments',
      JSON.stringify({ state: { maxImageSizeMB: 33 }, version: 0 })
    )
    await hydrateBackendStores()
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(33)
  })

  it('is independent of the document limit', () => {
    const docBefore = useAttachments.getState().maxFileSizeMB
    useImageAttachmentConfig.getState().setMaxImageSizeMB(60)
    expect(useAttachments.getState().maxFileSizeMB).toBe(docBefore)
    useAttachments.setState({ maxFileSizeMB: 150 })
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(60)
    useAttachments.setState({ maxFileSizeMB: docBefore })
  })

  it('treats null and an empty string as non-numeric, not as 0', () => {
    useImageAttachmentConfig.setState({ maxImageSizeMB: 25 })
    useImageAttachmentConfig.getState().setMaxImageSizeMB(null as never)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(25)
    useImageAttachmentConfig.getState().setMaxImageSizeMB('' as never)
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(25)
  })
})
