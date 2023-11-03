'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { ReactNode, useEffect, useRef } from 'react'
import { appDownloadProgress } from './JotaiWrapper'
import { PluginType } from '@janhq/core'
import {
  setDownloadStateAtom,
  setDownloadStateSuccessAtom,
} from './atoms/DownloadState.atom'
import { getDownloadedModels } from '../hooks/useGetDownloadedModels'
import { downloadedModelAtom } from './atoms/DownloadedModel.atom'
import EventHandler from './EventHandler'
import { pluginManager } from '@plugin/PluginManager'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { downloadingModelsAtom } from './atoms/Model.atom'

type Props = {
  children: ReactNode
}

export default function EventListenerWrapper({ children }: Props) {
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const setDownloadStateSuccess = useSetAtom(setDownloadStateSuccessAtom)
  const setProgress = useSetAtom(appDownloadProgress)
  const setDownloadedModels = useSetAtom(downloadedModelAtom)
  const models = useAtomValue(downloadingModelsAtom)
  const modelsRef = useRef(models)
  useEffect(() => {
    modelsRef.current = models
  }, [models])

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
          setDownloadStateSuccess(callback.fileName)
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
                  getDownloadedModels().then((models) => {
                    setDownloadedModels(models)
                  })
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

      window.electronAPI.onAppUpdateDownloadSuccess(
        (_event: string, callback: any) => {
          setProgress(-1)
        }
      )
    }
  }, [])

  return (
    <div id="eventlistener">
      <EventHandler>{children}</EventHandler>
    </div>
  )
}
