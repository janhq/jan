'use client'

import { PropsWithChildren } from 'react'
import { PluginService } from '@janhq/core'
import { ThemeWrapper } from '@helpers/ThemeWrapper'
import JotaiWrapper from '@helpers/JotaiWrapper'
import { ModalWrapper } from '@helpers/ModalWrapper'
import { useEffect, useState } from 'react'
import CompactLogo from '@containers/Logo/CompactLogo'
import { setup, plugins, activationPoints, extensionPoints } from '@plugin'
import EventListenerWrapper from '@helpers/EventListenerWrapper'
import { setupCoreServices } from '@services/coreService'
import {
  executeSerial,
  isCorePluginInstalled,
  setupBasePlugins,
} from '@services/pluginService'

const Providers = (props: PropsWithChildren) => {
  const [setupCore, setSetupCore] = useState(false)
  const [activated, setActivated] = useState(false)

  const { children } = props

  async function setupPE() {
    // Enable activation point management
    setup({
      importer: (plugin: string) =>
        import(/* webpackIgnore: true */ plugin).catch((err) => {
          console.log(err)
        }),
    })

    // Register all active plugins with their activation points
    await plugins.registerActive()
    setTimeout(async () => {
      // Trigger activation points
      await activationPoints.trigger('init')
      if (!isCorePluginInstalled()) {
        setupBasePlugins()
        return
      }
      if (extensionPoints.get(PluginService.OnStart)) {
        await executeSerial(PluginService.OnStart)
      }
      setActivated(true)
    }, 500)
  }

  // Services Setup
  useEffect(() => {
    setupCoreServices()
    setSetupCore(true)
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
            <EventListenerWrapper>
              <ModalWrapper>{children}</ModalWrapper>
            </EventListenerWrapper>
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
