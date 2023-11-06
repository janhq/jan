/* eslint-disable @typescript-eslint/no-explicit-any */

import { PropsWithChildren, useEffect, useRef } from 'react'

import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'

import { useAtomValue, useSetAtom } from 'jotai'

import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import EventHandler from './EventHandler'

import { appDownloadProgress } from './Jotai'

import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'
import { pluginManager } from '@/plugin/PluginManager'

export default function EventListenerWrapper({ children }: PropsWithChildren) {
  const setProgress = useSetAtom(appDownloadProgress)
  const models = useAtomValue(downloadingModelsAtom)
  const modelsRef = useRef(models)
  useEffect(() => {
    modelsRef.current = models
  }, [models])
  const { setDownloadedModels, downloadedModels } = useGetDownloadedModels()
  const { setDownloadState, setDownloadStateSuccess } = useDownloadState()

  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onFileDownloadUpdate(
        (_event: string, state: DownloadState | undefined) => {
          if (!state) return
          setDownloadState(state)
        }
      )

      window.electronAPI.onFileDownloadError(
        (_event: string, callback: any) => {
          console.log('Download error', callback)
          const fileName = callback.fileName.replace('models/', '')
          setDownloadStateSuccess(fileName)
        }
      )

      window.electronAPI.onFileDownloadSuccess(
        (_event: string, callback: any) => {
          if (callback && callback.fileName) {
            const fileName = callback.fileName.replace('models/', '')
            setDownloadStateSuccess(fileName)

            const model = modelsRef.current.find((e) => e._id === fileName)
            if (model)
              pluginManager
                .get<ModelPlugin>(PluginType.Model)
                ?.saveModel(model)
                .then(() => {
                  setDownloadedModels([...downloadedModels, model])
                  setDownloadedModels(models)
                })
          }
        }
      )

      window.electronAPI.onAppUpdateDownloadUpdate(
        (_event: string, progress: any) => {
          setProgress(progress.percent)
          console.log('app update progress:', progress.percent)
        }
      )

      window.electronAPI.onAppUpdateDownloadError(
        (_event: string, callback: any) => {
          console.log('Download error', callback)
          setProgress(-1)
        }
      )

      window.electronAPI.onAppUpdateDownloadSuccess(() => {
        setProgress(-1)
      })
    }
  }, [
    setDownloadedModels,
    setDownloadState,
    setDownloadStateSuccess,
    setProgress,
    downloadedModels,
    models,
  ])

  return (
    <div id="eventlistener">
      <EventHandler>{children}</EventHandler>
    </div>
  )
}
