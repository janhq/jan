import { PropsWithChildren, useCallback, useEffect } from 'react'

import React from 'react'

import { DownloadEvent, events, DownloadState } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { setDownloadStateAtom } from '@/hooks/useDownloadState'

import AppUpdateListener from './AppUpdateListener'
import ClipboardListener from './ClipboardListener'
import EventHandler from './EventHandler'

import ModelImportListener from './ModelImportListener'
import QuickAskListener from './QuickAskListener'

import {
  InstallingExtensionState,
  removeInstallingExtensionAtom,
  setInstallingExtensionAtom,
} from '@/helpers/atoms/Extension.atom'

const EventListenerWrapper = ({ children }: PropsWithChildren) => {
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const setInstallingExtension = useSetAtom(setInstallingExtensionAtom)
  const removeInstallingExtension = useSetAtom(removeInstallingExtensionAtom)

  const onFileDownloadUpdate = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadUpdate', state)
      if (state.downloadType === 'extension') {
        const downloadPercentage: InstallingExtensionState = {
          extensionId: state.extensionId!,
          percentage: state.percent,
        }
        setInstallingExtension(state.extensionId!, downloadPercentage)
      } else {
        setDownloadState(state)
      }
    },
    [setDownloadState, setInstallingExtension]
  )

  const onFileDownloadError = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadError', state)
      if (state.downloadType === 'extension') {
        removeInstallingExtension(state.extensionId!)
      } else {
        setDownloadState(state)
      }
    },
    [setDownloadState, removeInstallingExtension]
  )

  const onFileDownloadSuccess = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadSuccess', state)
      if (state.downloadType === 'extension') {
        removeInstallingExtension(state.extensionId!)
      } else {
        setDownloadState(state)
      }
    },
    [setDownloadState, removeInstallingExtension]
  )

  useEffect(() => {
    console.debug('EventListenerWrapper: registering event listeners...')
    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)

    return () => {
      console.debug('EventListenerWrapper: unregistering event listeners...')
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    }
  }, [onFileDownloadUpdate, onFileDownloadError, onFileDownloadSuccess])

  return (
    <AppUpdateListener>
      <ClipboardListener>
        <ModelImportListener>
          <QuickAskListener>
            <EventHandler>{children}</EventHandler>
          </QuickAskListener>
        </ModelImportListener>
      </ClipboardListener>
    </AppUpdateListener>
  )
}

export default EventListenerWrapper
