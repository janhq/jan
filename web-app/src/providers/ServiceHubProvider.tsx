import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'
import { hydrateBackendStores } from '@/lib/hydrateStores'
import { migrateLocalStorageToBackend } from '@/lib/migrateLocalStorageSettings'

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
        setIsReady(true)
      })
      .catch((error) => {
        console.error('Service initialization failed:', error)
        setIsReady(true) // Still render to show error state
      })
  }, [])

  return <>{isReady && children}</>
}
