import { useDownloadEvents } from '@/hooks/useDownloadEvents'

/**
 * Keeps the download store fed for the whole app lifetime. Mounted at the root
 * rather than beside the download popover, which is not present on every screen.
 */
export function DownloadEventListener() {
  useDownloadEvents()
  return null
}
