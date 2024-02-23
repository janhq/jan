/* eslint-disable @typescript-eslint/no-explicit-any */
import { PropsWithChildren, useCallback, useEffect } from 'react'

import React from 'react'

import { DownloadEvent, events, DownloadState } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { setDownloadStateAtom } from '@/hooks/useDownloadState'

import EventHandler from './EventHandler'

import { appDownloadProgress } from './Jotai'

const EventListenerWrapper = ({ children }: PropsWithChildren) => {
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const setProgress = useSetAtom(appDownloadProgress)

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

  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onAppUpdateDownloadUpdate(
        (_event: string, progress: any) => {
          setProgress(progress.percent)
          console.debug('app update progress:', progress.percent)
        }
      )

      window.electronAPI.onAppUpdateDownloadError(
        (_event: string, callback: any) => {
          console.error('Download error', callback)
          setProgress(-1)
        }
      )

      window.electronAPI.onAppUpdateDownloadSuccess(() => {
        setProgress(-1)
      })
    }
    return () => {}
  }, [setDownloadState, setProgress])

  return <EventHandler>{children}</EventHandler>
}

export default EventListenerWrapper
