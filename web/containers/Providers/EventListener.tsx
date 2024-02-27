import { PropsWithChildren, useCallback, useEffect } from 'react'

import React from 'react'

import { DownloadEvent, events, DownloadState } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { setDownloadStateAtom } from '@/hooks/useDownloadState'

import AppUpdateListener from './AppUpdateListener'
import EventHandler from './EventHandler'

import ModelImportListener from './ModelImportListener'

const EventListenerWrapper = ({ children }: PropsWithChildren) => {
  const setDownloadState = useSetAtom(setDownloadStateAtom)

  const onFileDownloadUpdate = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadUpdate', state)
      setDownloadState(state)
    },
    [setDownloadState]
  )

  const onFileDownloadError = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadError', state)
      setDownloadState(state)
    },
    [setDownloadState]
  )

  const onFileDownloadSuccess = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadSuccess', state)
      setDownloadState(state)
    },
    [setDownloadState]
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
      <ModelImportListener>
        <EventHandler>{children}</EventHandler>
      </ModelImportListener>
    </AppUpdateListener>
  )
}

export default EventListenerWrapper
