'use client'

import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

import Loader from '@/containers/Loader'

import { setupCoreServices } from '@/services/coreService'
import {
  isCoreExtensionInstalled,
  setupBaseExtensions,
} from '@/services/extensionService'

import { extensionManager } from '@/extension'

export const CoreConfigurator = ({ children }: PropsWithChildren) => {
  const [setupCore, setSetupCore] = useState(false)
  const [activated, setActivated] = useState(false)
  const [settingUp, setSettingUp] = useState(false)

  const setupExtensions = useCallback(async () => {
    // Register all active extensions
    await extensionManager.registerActive()

    setTimeout(async () => {
      if (!isCoreExtensionInstalled()) {
        setSettingUp(true)
        await setupBaseExtensions()
        return
      }

      extensionManager.load()
      setSettingUp(false)
      setActivated(true)
    }, 500)
  }, [])

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
  }, [setupCore, setupExtensions])

  return (
    <>
      {settingUp && <Loader description="Preparing Update..." />}
      {setupCore && activated && <>{children}</>}
    </>
  )
}
