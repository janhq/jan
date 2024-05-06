'use client'

import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

import { Toaster } from 'react-hot-toast'

import Loader from '@/containers/Loader'
import EventListenerWrapper from '@/containers/Providers/EventListener'
import JotaiWrapper from '@/containers/Providers/Jotai'

import { setupCoreServices } from '@/services/coreService'
import {
  isCoreExtensionInstalled,
  setupBaseExtensions,
} from '@/services/extensionService'

import Umami from '@/utils/umami'

import DataLoader from './DataLoader'

import DeepLinkListener from './DeepLinkListener'
import KeyListener from './KeyListener'

import { extensionManager } from '@/extension'

const Providers = ({ children }: PropsWithChildren) => {
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
    <JotaiWrapper>
      <Umami />
      {settingUp && <Loader description="Preparing Update..." />}
      {setupCore && activated && (
        <KeyListener>
          <EventListenerWrapper>
            <DataLoader>
              <DeepLinkListener>{children}</DeepLinkListener>
            </DataLoader>
          </EventListenerWrapper>
          <Toaster />
        </KeyListener>
      )}
    </JotaiWrapper>
  )
}

export default Providers
