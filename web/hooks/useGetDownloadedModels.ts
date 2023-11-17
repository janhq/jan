import { useEffect } from 'react'

const downloadedModelAtom = atom<Model[]>([])
import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'
import { atom, useAtom } from 'jotai'

import { pluginManager } from '@/plugin/PluginManager'

export function useGetDownloadedModels() {
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelAtom)

  async function getDownloadedModels(): Promise<Model[]> {
    const models = await pluginManager
      .get<ModelPlugin>(PluginType.Model)
      ?.getDownloadedModels()
    return models ?? []
  }

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels)
    })
  }, [setDownloadedModels])

  return { downloadedModels, setDownloadedModels }
}
