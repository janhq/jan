import { getServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'

/**
 * Add the threads the backend has and the store lacks. Used when something
 * created threads after the first list (the Cowork migration finishing in the
 * background). A failure propagates; the caller decides it is non-fatal.
 *
 * It MERGES, never replaces: the app is already interactive when this runs, so
 * the store is newer than the fetched list. Threads already in the store keep
 * their state (renames, favourites, order); a thread created while the fetch
 * was in flight stays; a thread the store held at any point during the fetch
 * and no longer holds was deleted meanwhile and is not brought back.
 */
export async function refreshThreadsFromBackend(): Promise<void> {
  // Every id the store held from the start of the fetch on.
  const seen = new Set(Object.keys(useThreads.getState().threads))
  const unsubscribe = useThreads.subscribe((state) => {
    for (const id of Object.keys(state.threads)) seen.add(id)
  })
  let fetched: Thread[]
  try {
    fetched = await getServiceHub().threads().fetchThreads()
  } finally {
    unsubscribe()
  }
  // No await from here: the store cannot change between this read and the write.
  const current = useThreads.getState().threads
  const late = fetched.filter((t) => !(t.id in current) && !seen.has(t.id))
  if (late.length === 0) return
  useThreads.getState().setThreads([...Object.values(current), ...late])
}
