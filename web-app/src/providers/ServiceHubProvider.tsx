import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'

interface ServiceHubProviderProps {
  children: React.ReactNode
}

export function ServiceHubProvider({ children }: ServiceHubProviderProps) {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    initializeServiceHub()
      .then((hub) => {
        console.log('Services initialized, initializing Zustand store')
        initializeServiceHubStore(hub)
        setIsReady(true)
      })
      .catch((error) => {
        console.error('Service initialization failed:', error)
        setIsReady(true) // Still render to show error state
      })
  }, [])

  return <>{isReady && children}</>
}
