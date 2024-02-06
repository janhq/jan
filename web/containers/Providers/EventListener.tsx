import { PropsWithChildren, useCallback, useEffect } from 'react'

import React from 'react'

import { DownloadEvent, events } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { setDownloadStateAtom } from '@/hooks/useDownloadState'

import EventHandler from './EventHandler'

const EventListenerWrapper = ({ children }: PropsWithChildren) => {
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  // const setProgress = useSetAtom(appDownloadProgress)

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
    console.log('EventListenerWrapper: registering event listeners...')

    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)

    return () => {
      console.log('EventListenerWrapper: unregistering event listeners...')
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    }
  }, [onFileDownloadUpdate, onFileDownloadError, onFileDownloadSuccess])

  // useEffect(() => {
  //   if (window && window.electronAPI) {
  //     window.electronAPI.onFileDownloadUpdate(
  //       async (_event: string, state: any | undefined) => {
  //         if (!state) return
  //         const modelName = await baseName(state.fileName)
  //         const model = modelsRef.current.find(
  //           (model) => modelBinFileName(model) === modelName
  //         )
  //         if (model)
  //           setDownloadState({
  //             ...state,
  //             modelId: model.id,
  //           })
  //       }
  //     )

  //     window.electronAPI.onFileDownloadError(
  //       async (_event: string, state: any) => {
  //         const modelName = await baseName(state.fileName)
  //         const model = modelsRef.current.find(
  //           (model) => modelBinFileName(model) === modelName
  //         )
  //         if (model) {
  //           if (state.err?.message !== 'aborted') {
  //             console.error('Download error', state)
  //             setDownloadStateFailed(model.id, state.err.message)
  //           } else {
  //             setDownloadStateCancelled(model.id)
  //           }
  //         }
  //       }
  //     )

  //     window.electronAPI.onFileDownloadSuccess(
  //       async (_event: string, state: any) => {
  //         if (state && state.fileName) {
  //           const modelName = await baseName(state.fileName)
  //           const model = modelsRef.current.find(
  //             (model) => modelBinFileName(model) === modelName
  //           )
  //           if (model) {
  //             setDownloadStateSuccess(model.id)
  //             setDownloadedModels([...downloadedModelRef.current, model])
  //           }
  //         }
  //       }
  //     )

  //     window.electronAPI.onAppUpdateDownloadUpdate(
  //       (_event: string, progress: any) => {
  //         setProgress(progress.percent)
  //         console.debug('app update progress:', progress.percent)
  //       }
  //     )

  //     window.electronAPI.onAppUpdateDownloadError(
  //       (_event: string, callback: any) => {
  //         console.error('Download error', callback)
  //         setProgress(-1)
  //       }
  //     )

  //     window.electronAPI.onAppUpdateDownloadSuccess(() => {
  //       setProgress(-1)
  //     })
  //   }
  //   return () => {}
  // }, [
  //   setDownloadState,
  //   setDownloadStateCancelled,
  //   setDownloadStateFailed,
  //   setDownloadStateSuccess,
  //   setDownloadedModels,
  //   setProgress,
  // ])

  return <EventHandler>{children}</EventHandler>
}

export default EventListenerWrapper
