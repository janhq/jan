import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

/** Default cap per image. Matches the previously hardcoded limit. */
export const DEFAULT_MAX_IMAGE_SIZE_MB = 10
export const MIN_MAX_IMAGE_SIZE_MB = 1
export const MAX_MAX_IMAGE_SIZE_MB = 100

/**
 * Coerce an arbitrary value to a whole number of MB within the allowed range.
 * Non-numeric input returns `fallback`.
 */
export const clampImageSizeMB = (
  value: unknown,
  fallback: number = DEFAULT_MAX_IMAGE_SIZE_MB
): number => {
  // null and '' coerce to 0, which would silently snap to the 1 MB floor.
  if (value === null || value === '') return fallback
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(
    MIN_MAX_IMAGE_SIZE_MB,
    Math.min(MAX_MAX_IMAGE_SIZE_MB, Math.floor(num))
  )
}

type ImageAttachmentConfigState = {
  /**
   * Maximum size of a single image attachment, in MB. Images are sent inline
   * as base64 data URLs, so this is independent of the document limit
   * (`max_file_size_mb` in the RAG extension). Providers and models may
   * enforce a lower limit of their own.
   */
  maxImageSizeMB: number
  setMaxImageSizeMB: (value: number) => void
}

export const useImageAttachmentConfig = create<ImageAttachmentConfigState>()(
  persist(
    (set, get) => ({
      maxImageSizeMB: DEFAULT_MAX_IMAGE_SIZE_MB,
      setMaxImageSizeMB: (value) =>
        set({ maxImageSizeMB: clampImageSizeMB(value, get().maxImageSizeMB) }),
    }),
    {
      name: localStorageKey.settingImageAttachments,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      // A hand-edited or corrupt record must not disable the limit.
      merge: (persisted, current) => ({
        ...current,
        maxImageSizeMB: clampImageSizeMB(
          (persisted as Partial<ImageAttachmentConfigState> | undefined)
            ?.maxImageSizeMB,
          current.maxImageSizeMB
        ),
      }),
    }
  )
)
