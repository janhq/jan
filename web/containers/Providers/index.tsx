'use client'

import { PropsWithChildren, useEffect, useState } from 'react'

import { Toaster } from 'react-hot-toast'

import { TooltipProvider } from '@janhq/uikit'

import EventListenerWrapper from '@/containers/Providers/EventListener'
import JotaiWrapper from '@/containers/Providers/Jotai'
import ThemeWrapper from '@/containers/Providers/Theme'

import FeatureToggleWrapper from '@/context/FeatureToggle'

import { setupCoreServices } from '@/services/coreService'
import {
  isCoreExtensionInstalled,
  setupBaseExtensions,
} from '@/services/extensionService'

import { extensionManager } from '@/extension'

const Providers = (props: PropsWithChildren) => {
  const [setupCore, setSetupCore] = useState(false)
  const [activated, setActivated] = useState(false)

  const { children } = props

  async function setupExtensions() {
    // Register all active extensions
    await extensionManager.registerActive()

    setTimeout(async () => {
      if (!isCoreExtensionInstalled()) {
        setupBaseExtensions()
        return
      }

      extensionManager.load()
      setActivated(true)
    }, 500)
  }

  // Services Setup
  useEffect(() => {
    setupCoreServices()
    setSetupCore(true)
    return () => {
      extensionManager.unload()
    }
  }, [])

  useEffect(() => {
    if (setupCore) {
      // Electron
      if (window && window.core?.api) {
        setupExtensions()
      } else {
        // Host
        setActivated(true)
      }
    }
  }, [setupCore])

  return (
    <JotaiWrapper>
      <ThemeWrapper>
        {setupCore && activated && (
          <FeatureToggleWrapper>
            <EventListenerWrapper>
              <TooltipProvider>{children}</TooltipProvider>
            </EventListenerWrapper>
            <Toaster position="top-right" />
          </FeatureToggleWrapper>
        )}
      </ThemeWrapper>
    </JotaiWrapper>
  )
}

export default Providers
