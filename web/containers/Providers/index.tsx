'use client'

import { PropsWithChildren, useEffect, useState } from 'react'

import { Toaster } from 'react-hot-toast'

import { PluginService } from '@janhq/core'

import { TooltipProvider } from '@janhq/uikit'

import EventListenerWrapper from '@/containers/Providers/EventListener'
import JotaiWrapper from '@/containers/Providers/Jotai'
import ThemeWrapper from '@/containers/Providers/Theme'

import FeatureToggleWrapper from '@/context/FeatureToggle'

import { setupCoreServices } from '@/services/coreService'
import {
  isCorePluginInstalled,
  setupBasePlugins,
} from '@/services/pluginService'

import { ModalWrapper } from '@/helpers/ModalWrapper'
import { setup, plugins, activationPoints, extensionPoints } from '@/plugin'

const Providers = (props: PropsWithChildren) => {
  const [setupCore, setSetupCore] = useState(false)
  const [activated, setActivated] = useState(false)

  const { children } = props

  async function setupPE() {
    // Register all active plugins with their activation points
    await pluginManager.registerActive()

    setTimeout(async () => {
      if (!isCorePluginInstalled()) {
        setupBasePlugins()
        return
      }

      pluginManager.load()
      setActivated(true)
    }, 500)
  }

  // Services Setup
  useEffect(() => {
    setupCoreServices()
    setSetupCore(true)
    return () => {
      pluginManager.unload()
    }
  }, [])

  useEffect(() => {
    if (setupCore) {
      // Electron
      if (window && window.coreAPI) {
        setupPE()
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
              <TooltipProvider>
                <ModalWrapper>{children}</ModalWrapper>
              </TooltipProvider>
            </EventListenerWrapper>
            <Toaster position="top-right" />
          </FeatureToggleWrapper>
        )}
      </ThemeWrapper>
    </JotaiWrapper>
  )
}

export default Providers
