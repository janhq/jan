import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'
import { hydrateBackendStores } from '@/lib/hydrateStores'
import { migrateLocalStorageToBackend } from '@/lib/migrateLocalStorageSettings'
import { migrateCoworkSessionsOnStartup } from '@/lib/migrateCoworkSessions'
import { refreshThreadsFromBackend } from '@/lib/refreshThreads'

/**
 * How long startup waits for the Cowork migration. Past it the app renders and
 * the migration keeps running; the thread list is refreshed when it finishes.
 */
export const COWORK_MIGRATION_BUDGET_MS = 3000

/** Resolves with the work's outcome, or with `'timeout'` after `ms`. */
async function withinBudget<T>(
  work: Promise<T>,
  ms: number
): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

interface ServiceHubProviderProps {
  children: React.ReactNode
}

export function ServiceHubProvider({ children }: ServiceHubProviderProps) {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    initializeServiceHub()
      .then(async (hub) => {
        console.log('Services initialized, initializing Zustand store')
        initializeServiceHubStore(hub)
        // One-time localStorage -> backend migration must run before hydration
        // so the backend store is populated before any store reads it.
        await migrateLocalStorageToBackend()
        // Settings stores use async backend storage; hydrate before rendering
        // children so no component reads pre-hydration defaults.
        await hydrateBackendStores()
        // One-time copy of Cowork sessions into threads. Children list threads
        // on mount, so it is awaited, but only for a bounded time: a huge
        // history must not keep the app from rendering. When it overruns, the
        // rest finishes in the background and the thread list is refreshed
        // then. Neither path throws.
        const migration = migrateCoworkSessionsOnStartup()
        const outcome = await withinBudget(
          migration.catch(() => null),
          COWORK_MIGRATION_BUDGET_MS
        )
        if (outcome === 'timeout') {
          void migration
            .then((late) => {
              if (late && late.migrated.length > 0) {
                return refreshThreadsFromBackend()
              }
            })
            .catch((error) => {
              console.warn('[cowork-migration] late refresh failed:', error)
            })
        }
        setIsReady(true)
      })
      .catch((error) => {
        console.error('Service initialization failed:', error)
        setIsReady(true) // Still render to show error state
      })
  }, [])

  return <>{isReady && children}</>
}
