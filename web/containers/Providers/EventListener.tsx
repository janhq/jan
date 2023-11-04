/* eslint-disable @typescript-eslint/no-explicit-any */

import { ReactNode, useEffect } from 'react'

import { useSetAtom } from 'jotai'

import { useDownloadState } from '@/hooks/useDownloadState'
import { getDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import EventHandler from './EventHandler'
import { appDownloadProgress } from './Jotai'
import { pluginManager } from '@plugin/PluginManager'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { downloadingModelsAtom } from './atoms/Model.atom'

type Props = {
  children: ReactNode
}

export default function EventListenerWrapper({ children }: Props) {
  const setProgress = useSetAtom(appDownloadProgress)
  const models = useAtomValue(downloadingModelsAtom)
  const modelsRef = useRef(models)
  useEffect(() => {
    modelsRef.current = models
  }, [models])
  const { setDownloadedModels } = useGetDownloadedModels()
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

      window.electronAPI.onAppUpdateDownloadSuccess(() => {
        setProgress(-1)
      })
    }
  }, [
    setDownloadState,
    setDownloadStateSuccess,
    setDownloadedModels,
    setProgress,
  ])

  return (
    <div id="eventlistener">
      <EventHandler>{children}</EventHandler>
    </div>
  )
}
