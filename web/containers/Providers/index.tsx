'use client'

import { PropsWithChildren } from 'react'
import { Variants, motion as m } from 'framer-motion'
import { PluginService } from '@janhq/core'
import { ThemeWrapper } from '@helpers/ThemeWrapper'
import JotaiWrapper from '@helpers/JotaiWrapper'
import { ModalWrapper } from '@helpers/ModalWrapper'
import { useEffect, useState } from 'react'
import CompactLogo from '@containers/Logo/CompactLogo'
import {
  setup,
  plugins,
  activationPoints,
  extensionPoints,
} from '../../../electron/core/plugin-manager/execution/index'
import {
  isCorePluginInstalled,
  setupBasePlugins,
} from '@services/pluginService'
import EventListenerWrapper from '@helpers/EventListenerWrapper'
import { setupCoreServices } from '@services/coreService'
import { executeSerial } from '../../../electron/core/plugin-manager/execution/extension-manager'

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
      if (window && window.electronAPI) {
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
        <EventListenerWrapper>
          <ThemeWrapper>
            {activated ? (
              <m.div
                initial={{ opacity: 0, y: -10 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    duration: 0.3,
                    type: 'spring',
                    stiffness: 200,
                  },
                }}
              >
                {children}
              </m.div>
            ) : (
              <div className="flex h-screen w-screen items-center justify-center">
                <CompactLogo width={56} height={56} />
              </div>
            )}
          </ThemeWrapper>
        </EventListenerWrapper>
      )}
    </JotaiWrapper>
  )
}

export default Providers
