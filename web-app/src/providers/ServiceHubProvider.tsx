import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'
import { hydrateBackendStores } from '@/lib/hydrateStores'
import { migrateLocalStorageToBackend } from '@/lib/migrateLocalStorageSettings'
import { startCoworkSync } from '@/lib/coworkSync'

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
        // Cowork sessions are threads: migrate legacy sessions (bounded wait,
        // the rest finishes in the background), load them and start
        // write-through, before any route renders so a deep link never sees an
        // empty store. A failed start must not keep the app from rendering.
        try {
          await startCoworkSync()
        } catch (error) {
          console.warn('[cowork] startup sync failed; the app still renders:', error)
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
