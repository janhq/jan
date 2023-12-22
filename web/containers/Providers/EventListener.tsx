/* eslint-disable @typescript-eslint/no-explicit-any */
import { PropsWithChildren, useEffect, useRef } from 'react'

import { useSetAtom } from 'jotai'

import {
  onDownloadFailedAtom,
  onDownloadUpdateAtom,
  onDownloadSuccessAtom,
} from '@/hooks/useDownloadState'

import EventHandler from './EventHandler'

import { appDownloadProgress } from './Jotai'

export default function EventListenerWrapper({ children }: PropsWithChildren) {
  const onDownloadUpdate = useSetAtom(onDownloadUpdateAtom)
  const onDownloadFailed = useSetAtom(onDownloadFailedAtom)
  const onDownloadSuccess = useSetAtom(onDownloadSuccessAtom)
  const setAppDownloadProgress = useSetAtom(appDownloadProgress)

  // prevent multiple event listener
  const isEventListenerRegisteredRef = useRef(false)

  useEffect(() => {
    if (isEventListenerRegisteredRef.current) return
    console.debug('Register event listener')
    if (window && window.electronAPI) {
      window.electronAPI.onFileDownloadUpdate(
        (_event: string, state: any | undefined) => {
          if (!state) return

          const fileName = state.fileName.split('/').pop() ?? ''
          onDownloadUpdate({
            ...state,
            modelId: fileName,
          })
        }
      )

      window.electronAPI.onFileDownloadError((_event: string, state: any) => {
        console.error('Download error', state)
        const fileName = state.fileName.split('/').pop() ?? ''
        onDownloadFailed(fileName)
      })

      window.electronAPI.onFileDownloadSuccess((_event: string, state: any) => {
        if (state && state.fileName) {
          console.debug(`onFileDownloadSuccess, ${JSON.stringify(state)}`)
          const fileName = state.fileName.split('/').pop() ?? ''
          onDownloadSuccess(fileName)
        }
      })

      window.electronAPI.onAppUpdateDownloadUpdate(
        (_event: string, progress: any) => {
          console.debug('app update progress:', progress.percent)
          setAppDownloadProgress(progress.percent)
        }
      )

      window.electronAPI.onAppUpdateDownloadError(
        (_event: string, callback: any) => {
          console.error('Download error', callback)
          setAppDownloadProgress(-1)
        }
      )

      window.electronAPI.onAppUpdateDownloadSuccess(() => {
        setAppDownloadProgress(-1)
      })
    }
    isEventListenerRegisteredRef.current = true
    return () => {}
  }, [])

  return (
    <div id="eventlistener">
      <EventHandler>{children}</EventHandler>
    </div>
  )
}
