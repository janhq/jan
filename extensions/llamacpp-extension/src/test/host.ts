import { vi } from 'vitest'
import llamacpp_extension from '../index'

/**
 * The host service registry the engine reaches the Downloads service
 * through. Tests set what `get` returns.
 */
export const hostServices = {
  get: vi.fn().mockReturnValue({
    downloadFiles: vi.fn().mockResolvedValue(undefined),
    cancelDownload: vi.fn().mockResolvedValue(undefined),
  }),
}

export function newExtension(): llamacpp_extension {
  return new llamacpp_extension(hostServices)
}
