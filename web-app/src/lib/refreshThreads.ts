import { getServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'

/**
 * Re-list threads from the backend into the thread store. Used when something
 * created threads after the first list (the Cowork migration finishing in the
 * background). Like DataProvider's load, an empty result never replaces a
 * populated list. A failure propagates; the caller decides it is non-fatal.
 */
export async function refreshThreadsFromBackend(): Promise<void> {
  const threads = await getServiceHub().threads().fetchThreads()
  if (
    threads.length === 0 &&
    Object.keys(useThreads.getState().threads).length > 0
  ) {
    return
  }
  useThreads.getState().setThreads(threads)
}
