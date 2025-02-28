'use client'

import { PropsWithChildren, useEffect, useState } from 'react'

import { setupCoreServices } from '@/services/coreService'

export const QuickAskConfigurator = ({ children }: PropsWithChildren) => {
  const [setupCore, setSetupCore] = useState(false)

  // Services Setup
  useEffect(() => {
    setupCoreServices()
    setSetupCore(true)
  }, [])

  return <>{setupCore && <>{children}</>}</>
}
