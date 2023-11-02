'use client'

import { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import CompactLogo from '@/containers/Logo/CompactLogo'
import { setupCoreServices } from '@/services/coreService'
import {
  isCorePluginInstalled,
  setupBasePlugins,
} from '@/services/pluginService'
import EventListenerWrapper from '@/helpers/EventListenerWrapper'
import { FeatureToggleWrapper } from '@/helpers/FeatureToggleWrapper'
import JotaiWrapper from '@/helpers/JotaiWrapper'
import { ModalWrapper } from '@/helpers/ModalWrapper'
import { ThemeWrapper } from '@/helpers/ThemeWrapper'

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
      {setupCore && (
        <ThemeWrapper>
          {activated ? (
            <FeatureToggleWrapper>
              <EventListenerWrapper>
                <ModalWrapper>{children}</ModalWrapper>
              </EventListenerWrapper>
            </FeatureToggleWrapper>
          ) : (
            <div className="flex h-screen w-screen items-center justify-center bg-background">
              <CompactLogo width={56} height={56} />
            </div>
          )}
        </ThemeWrapper>
      )}
    </JotaiWrapper>
  )
}

export default Providers
