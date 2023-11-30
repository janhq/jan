/* eslint-disable @typescript-eslint/no-explicit-any */

import { PropsWithChildren, useEffect, useRef } from 'react'

import { ExtensionType } from '@janhq/core'
import { ModelExtension } from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import EventHandler from './EventHandler'

import { appDownloadProgress } from './Jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'

export default function EventListenerWrapper({ children }: PropsWithChildren) {
  const setProgress = useSetAtom(appDownloadProgress)
  const models = useAtomValue(downloadingModelsAtom)
  const modelsRef = useRef(models)
  useEffect(() => {
    modelsRef.current = models
  }, [models])
  const { setDownloadedModels, downloadedModels } = useGetDownloadedModels()
  const { setDownloadState, setDownloadStateSuccess, setDownloadStateFailed } =
    useDownloadState()
  const downloadedModelRef = useRef(downloadedModels)

  useEffect(() => {
    downloadedModelRef.current = downloadedModels
  }, [downloadedModels])

  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onFileDownloadUpdate(
        (_event: string, state: any | undefined) => {
          if (!state) return
          setDownloadState({
            ...state,
            modelId: state.fileName.split('/').pop() ?? '',
          })
        }
      )

      window.electronAPI.onFileDownloadError(
        (_event: string, callback: any) => {
          console.error('Download error', callback)
          const modelId = callback.fileName.split('/').pop() ?? ''
          setDownloadStateFailed(modelId)
        }
      )

      window.electronAPI.onFileDownloadSuccess(
        (_event: string, callback: any) => {
          if (callback && callback.fileName) {
            const modelId = callback.fileName.split('/').pop() ?? ''
            setDownloadStateSuccess(modelId)

            const model = modelsRef.current.find((e) => e.id === modelId)
            if (model)
              extensionManager
                .get<ModelExtension>(ExtensionType.Model)
                ?.saveModel(model)
                .then(() => {
                  setDownloadedModels([...downloadedModelRef.current, model])
                })
          }
        }
      )

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
  }, [])

  return (
    <div id="eventlistener">
      <EventHandler>{children}</EventHandler>
    </div>
  )
}
