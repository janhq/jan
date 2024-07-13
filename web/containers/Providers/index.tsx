'use client'

import { Fragment, PropsWithChildren, useEffect, useState } from 'react'

import { Toaster } from 'react-hot-toast'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import EventListenerWrapper from '@/containers/Providers/EventListener'
import JotaiWrapper from '@/containers/Providers/Jotai'

import ThemeWrapper from '@/containers/Providers/Theme'

import { setupCoreServices } from '@/services/coreService'

import Umami from '@/utils/umami'

import DataLoader from './DataLoader'
import ModalMigrations from './ModalMigrations'

import Responsive from './Responsive'

const queryClient = new QueryClient()

const Providers = ({ children }: PropsWithChildren) => {
  const [setupCore, setSetupCore] = useState(false)

  // Services Setup
  useEffect(() => {
    setupCoreServices()
    setSetupCore(true)
  }, [])

  return (
    <ThemeWrapper>
      <JotaiWrapper>
        <QueryClientProvider client={queryClient}>
          <Umami />
          {setupCore && (
            <Fragment>
              <DataLoader />
              <EventListenerWrapper />
              <Responsive>{children}</Responsive>
              <Toaster />
            </Fragment>
          )}
          <ModalMigrations />
        </QueryClientProvider>
      </JotaiWrapper>
    </ThemeWrapper>
  )
}

export default Providers
